const https = require('node:https');

const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const webAppUrl =
  process.env.APP_URL ||
  process.env.WEB_APP_URL ||
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : '');
const apiBase = token ? `https://api.telegram.org/bot${token}` : '';

if (!token) {
  console.error('BOT_TOKEN is required to start the Telegram bot.');
  process.exit(1);
}

if (!webAppUrl) {
  console.error('WEB_APP_URL or REPLIT_DEV_DOMAIN is required to create the Mini App button.');
  process.exit(1);
}

const request = (method, body = {}) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const requestUrl = new URL(`${apiBase}/${method}`);
    const request = https.request(
      {
        protocol: requestUrl.protocol,
        hostname: requestUrl.hostname,
        path: `${requestUrl.pathname}${requestUrl.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          try {
            const result = JSON.parse(responseBody);
            if (!result.ok) {
              reject(new Error(result.description || `Telegram API error in ${method}`));
              return;
            }
            resolve(result.result);
          } catch (error) {
            reject(new Error(`Invalid Telegram API response in ${method}: ${error.message}`));
          }
        });
      }
    );

    request.on('error', reject);
    request.write(payload);
    request.end();
  });

const sendWelcome = (chatId, firstName) =>
  request('sendMessage', {
    chat_id: chatId,
    text: `Привет${firstName ? `, ${firstName}` : ''}! Добро пожаловать в GX Exchange — рынок коллекционных подарков Telegram.`,
    reply_markup: {
      inline_keyboard: [[{ text: 'Открыть GX Exchange', web_app: { url: webAppUrl } }]],
    },
  });

const sendHelp = (chatId) =>
  request('sendMessage', {
    chat_id: chatId,
    text: 'Команды GX Exchange:\n/start — открыть биржу\n/app — открыть Mini App\n/help — показать эту справку',
    reply_markup: {
      inline_keyboard: [[{ text: 'Открыть GX Exchange', web_app: { url: webAppUrl } }]],
    },
  });

const handleUpdate = async (update) => {
  const message = update.message;
  if (!message?.chat?.id || !message.text) return;

  const command = message.text.trim().split(/\s+/)[0].toLowerCase().split('@')[0];
  if (command === '/start' || command === '/app') {
    await sendWelcome(message.chat.id, message.from?.first_name);
  } else if (command === '/help') {
    await sendHelp(message.chat.id);
  }
};

const poll = async () => {
  let offset = 0;
  console.log(`GX Telegram bot is running. Mini App URL: ${webAppUrl}`);

  try {
    const bot = await request('getMe');
    console.log(`Connected as @${bot.username || bot.first_name}.`);

    while (true) {
      const updates = await request('getUpdates', {
        offset,
        timeout: 25,
        allowed_updates: ['message'],
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await handleUpdate(update);
        } catch (error) {
          console.error(`Failed to handle update ${update.update_id}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    console.error(`Telegram bot stopped: ${error.message}`);
    process.exitCode = 1;
  }
};

poll();
