import { chromium } from 'playwright-core';
import fs from 'fs'; // <-- Добавлено для работы с файлами

/**
 * Env:
 * - BROWSERLESS_WS: wss://…browserless.io?token=...&stealth=true
 * - (необяз.) POSTBACK_BASE / POSTBACK_TYPE — если захотите переопределить
 */
const { BROWSERLESS_WS } = process.env;
const POSTBACK_BASE = process.env.POSTBACK_BASE || 'https://rtrk.swipey.club/postback';
const POSTBACK_TYPE = process.env.POSTBACK_TYPE || 'registration';

if (!BROWSERLESS_WS) {
  console.warn('Missing BROWSERLESS_WS env var. Set wss://...browserless.io?token=...');
}

/** === Основной раннер регистрации === */
async function runSignup(payload) {
  const { email, password, firstName, lastName, messengerType, messenger, ref } = payload;

  let browser;
  try {
    const wsEndpoint = BROWSERLESS_WS;
    if (!wsEndpoint) throw new Error('BROWSERLESS_WS is not configured');

    // Подключение к Browserless по CDP
    browser = await chromium.connectOverCDP(wsEndpoint);

    // Контекст/страница
    const contexts = browser.contexts();
    const context = contexts.length ? contexts[0] : await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'UTC'
    });
    const page = await context.newPage();

    // Режем тяжёлые ресурсы (быстрее)
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'media' || type === 'font') return route.abort();
      return route.continue();
    });
    page.setDefaultTimeout(15000);

    // URL c поддержкой ?ref=...
    const baseUrl = 'https://affiliate.swipey.ai/signup';
    const signupUrl = ref ? `${baseUrl}?ref=${encodeURIComponent(ref)}` : baseUrl;

    // ШАГ 1
    await page.goto(signupUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.locator('input[name="email"][type="text"], input[name="email"][type="email"]').fill(email);
    await page.locator('input[name="password"][type="password"]').fill(password);

    // сабмит шага 1: Enter по паролю (часто быстрее), фоллбек — клик по кнопке
    await page.locator('input[name="password"][type="password"]').press('Enter').catch(async () => {
      const submit1 = page.locator(
        'button[type="submit"].btn.btn-primary.account__btn.account__btn--small',
        { hasText: 'Sign Up' }
      );
      await submit1.waitFor({ state: 'visible' });
      const el1 = await submit1.elementHandle();
      await page.waitForFunction(el => !!el && !el.disabled, el1);
      await submit1.click();
    });

    // --- БЛОК С ИСПРАВЛЕНИЕМ ---
    try {
        // ждём поля 2-го шага
        await page.waitForSelector('input[name="firstname"]', { timeout: 20000 });
    } catch (error) {
        console.error('Не удалось найти поле "firstname". Сохраняю отладочную информацию...');
        
        // Делаем скриншот того, что видит браузер
        await page.screenshot({ path: 'debug_screenshot.png', fullPage: true });
        
        // Сохраняем HTML-код страницы
        const html = await page.content();
        fs.writeFileSync('debug_page.html', html);
        
        console.log(`Отладочный скриншот сохранён в 'debug_screenshot.png'`);
        console.log(`HTML страницы сохранён в 'debug_page.html'`);
        console.log(`Текущий URL: ${page.url()}`);
        
        // Пробрасываем ошибку дальше, чтобы скрипт остановился
        throw error;
    }
    // --- КОНЕЦ БЛОКА С ИСПРАВЛЕНИЕМ ---

    // ШАГ 2
    await page.locator('input[name="firstname"]').fill(firstName);
    await page.locator('input[name="lastname"]').fill(lastName);

    if (messengerType) {
      const control = page.locator('.react-select__input__control, .react-select__control').first();
      await control.waitFor({ state: 'visible', timeout: 15000 });
      await control.click();

      const rsInput = page.locator('input[id^="react-select-"][id$="-input"][type="text"]').first();
      await rsInput.waitFor({ state: 'visible', timeout: 10000 });
      await rsInput.fill('');
      await rsInput.type(String(messengerType), { delay: 20 });

      const option = page.locator('.react-select__option, [class*="react-select__option"]')
                          .filter({ hasText: new RegExp(String(messengerType), 'i') }).first();
      const hasOption = await option.isVisible().catch(() => false);
      if (hasOption) await option.click(); else await page.keyboard.press('Enter');

      await page.waitForFunction(() => {
        const el = document.querySelector('input[name="messenger_type"]');
        return !!el && typeof el.value === 'string' && el.value.length > 0;
      }, null, { timeout: 10000 });
    }

    if (messenger) {
      await page.locator('input[name="messenger"]').fill(messenger);
    }

    // Сабмит шага 2
    const submit2 = page.locator(
      'button[type="submit"].btn.btn-primary.account__btn.account__btn--small',
      { hasText: 'Complete Sign Up' }
    );
    await submit2.waitFor({ state: 'visible', timeout: 15000 });
    const el2 = await submit2.elementHandle();
    await page.waitForFunction(el => !!el && !el.disabled, el2).catch(() => {});
    await submit2.click();

    // Быстрое целевое ожидание «успешного» состояния
    const successSel = page.locator('text=/Check your email|Verify|Dashboard/i');
    await Promise.race([
      successSel.first().waitFor({ timeout: 20000 }),
      page.waitForResponse(resp => resp.url().includes('/api') && resp.status() >= 400, { timeout: 20000 }).catch(() => {})
    ]).catch(() => {});

    const html = (await page.content()) || '';
    const ok = /thank|verify|check your email|dashboard/i.test(html);

    return { ok, html };
  } finally {
    try { await browser?.close(); } catch {}
  }
}

/** === HTTP handler (для QStash) === */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const payload = req.body || {};
  const { clickid } = payload;

  try {
    const { ok } = await runSignup(payload);

    // Постбек только при фактическом успехе
    if (ok && clickid) {
      const url = `${POSTBACK_BASE}?clickid=${encodeURIComponent(clickid)}&type=${encodeURIComponent(POSTBACK_TYPE)}&ts=${Date.now()}`;
      await fetch(url, { method: 'GET' }).catch(() => {});
    }

    return res.status(200).json({ ok });
  } catch (err) {
    console.error('signup-proxy error:', err);
    return res.status(500).json({ error: err.message || 'Automation failed' });
  }
}
