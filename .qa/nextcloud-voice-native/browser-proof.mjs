// CI-only presentation proof against the disposable official Talk web client.
// Screenshots contain only synthetic message nodes, never login or credentials.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const talkRef = 'eed360d176edcb6888dad60965cb694e6bf62ae3'; // v25.0.6
const talkSource = relative => `https://github.com/nextcloud/spreed/blob/${talkRef}/${relative}`;

export async function proveTalkVoicePresentation({origin, recipient, password, roomToken, cases, evidence}) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'presentation proof is CI-only');
  assert.equal(origin, 'http://127.0.0.1:18080', 'only the disposable loopback server is allowed');
  assert.match(roomToken, /^[a-z0-9]{4,30}$/u);
  assert.equal(recipient, 'outbound-recipient', 'only the disposable recipient is allowed');
  assert.equal(typeof password, 'string');
  assert(password.length > 0);
  assert(path.isAbsolute(evidence));
  const ordinary = cases.find(entry => entry.label === 'ordinary-audio');
  const voice = cases.find(entry => entry.label === 'synthesized-voice');
  assert(ordinary && voice, 'native and ordinary MP3 transport cases must already have passed');
  assert.equal(ordinary.messageType, 'comment');
  assert.equal(voice.messageType, 'voice-message');
  assert.equal(ordinary.fileMimeType, 'audio/mpeg');
  assert.equal(voice.fileMimeType, 'audio/mpeg');
  assert.equal(ordinary.recipientByteEquality, true);
  assert.equal(voice.recipientByteEquality, true);
  assert.match(voice.audioSha256, /^[a-f0-9]{64}$/u);
  assert.equal(ordinary.audioSha256, voice.audioSha256, 'baseline and native voice must use identical MP3 bytes');
  for (const entry of [ordinary, voice]) assert.match(String(entry.nativeChatId), /^[1-9]\d*$/u);
  assert.notEqual(String(ordinary.nativeChatId), String(voice.nativeChatId));
  await fs.mkdir(evidence, {recursive: true});

  const result = {
    status: 'FAIL',
    scope: 'Actual disposable Talk web UI in headless Chromium; ordinary MP3 baseline and native voice use identical synthetic audio bytes.',
    limitations: 'Not production deployment, human speech synthesis, audible playback, physical-device, mobile-client, or accessibility certification. Before/after are presentation modes in one unchanged client, not separate builds.',
    server: {origin, talkVersion: '25.0.6'},
    selectors: {
      message: 'li#message_{nativeChatId}[data-message-id="{nativeChatId}"]',
      player: '.audio-player audio[controls]',
      filename: '.audio-player__name',
    },
    sourceContracts: [
      talkSource('src/components/MessagesList/MessagesGroup/Message/MessageItem.vue#L6-L10'),
      talkSource('src/components/MessagesList/MessagesGroup/Message/MessagePart/AudioPlayer.vue#L6-L18'),
      talkSource('src/components/MessagesList/MessagesGroup/Message/MessagePart/FilePreview.vue#L302-L310'),
      talkSource('lib/Controller/PageController.php#L82-L91'),
      'https://github.com/nextcloud/server/blob/stable35/core/src/components/login/LoginForm.vue',
    ],
    sameMp3Sha256: voice.audioSha256,
    screenshots: [],
    browserContextClosed: false,
    browserClosed: false,
    blockedOffOriginRequests: 0,
  };
  let browser, context, failure;
  // Do not persist Playwright traces, storage state, network headers or login HTML.
  const safeError = error => String(error).split(password).join('[redacted]');
  try {
    const {chromium} = await import('playwright');
    browser = await chromium.launch({headless: true});
    result.browserVersion = browser.version();
    context = await browser.newContext({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1, locale: 'en-US', reducedMotion: 'reduce'});
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) {
        await route.continue();
      } else {
        result.blockedOffOriginRequests++;
        await route.abort('blockedbyclient');
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    page.setDefaultNavigationTimeout(90_000);
    await page.goto(`${origin}/index.php/login`, {waitUntil: 'domcontentloaded'});
    await page.locator('input#user').fill(recipient);
    await page.locator('input#password').fill(password);
    await page.locator('form.login-form button[type="submit"]').click();
    await page.locator('input#password').waitFor({state: 'hidden'});
    assert.equal(new URL(page.url()).origin, origin, 'login must stay on the disposable server');
    await page.goto(`${origin}/index.php/call/${roomToken}`, {waitUntil: 'domcontentloaded'});
    assert.equal(new URL(page.url()).origin, origin);

    async function capture(entry, basename, expectFilename) {
      const id = String(entry.nativeChatId);
      const message = page.locator(`li#message_${id}[data-message-id="${id}"]`);
      await message.waitFor({state: 'visible'});
      await message.scrollIntoViewIfNeeded();
      const audio = message.locator('.audio-player audio[controls]');
      await audio.waitFor({state: 'visible'});
      assert.equal(await audio.count(), 1, 'the exact message must contain one native audio control');
      const filename = message.locator('.audio-player__name');
      let visibleFilename;
      if (expectFilename) {
        await filename.waitFor({state: 'visible'});
        assert.equal(await filename.count(), 1);
        visibleFilename = (await filename.innerText()).trim();
        assert.match(visibleFilename, /\.mp3$/iu, 'ordinary audio retains its MP3 filename');
      } else {
        assert.equal(await filename.count(), 0, 'native voice omits the visible audio filename node');
        assert.equal(await message.locator('.name-container__name:visible').count(), 0, 'native voice must not expose a file-card filename either');
      }
      const player = await audio.evaluate(element => ({
        tag: element.tagName.toLowerCase(),
        controls: element.controls,
        hasSource: Boolean(element.currentSrc || element.getAttribute('src')),
        paused: element.paused,
      }));
      assert.equal(player.controls, true);
      assert.equal(player.hasSource, true, 'rendered control must have a media source');
      // Keep mouse away so hover-only action bars cannot obscure either crop.
      await page.mouse.move(0, 0);
      await page.evaluate(async () => {await document.fonts.ready;});
      const buffer = await message.screenshot({path: path.join(evidence, basename), animations: 'disabled', caret: 'hide', timeout: 30_000});
      result.screenshots.push({
        file: basename,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        nativeChatId: id,
        label: entry.label,
        messageType: entry.messageType,
        audioSha256: entry.audioSha256,
        audioPlayer: player,
        visibleFilename: visibleFilename ?? null,
        filenameVisible: expectFilename,
        crop: 'Exact Talk li message node; no login, credentials, surrounding chat, or account chrome.',
      });
    }

    await capture(ordinary, 'before-ordinary-audio.png', true);
    await capture(voice, 'after-native-voice.png', false);
    result.status = 'PASS';
  } catch (error) {
    failure = error;
    result.error = safeError(error);
  } finally {
    if (context) {
      try {await context.close(); result.browserContextClosed = true;}
      catch (error) {failure ??= error; result.contextCloseError = safeError(error);}
    }
    if (browser) {
      try {await browser.close(); result.browserClosed = !browser.isConnected();}
      catch (error) {failure ??= error; result.browserCloseError = safeError(error);}
    }
    if (!result.browserContextClosed || !result.browserClosed) result.status = 'FAIL';
    await fs.writeFile(path.join(evidence, 'browser-presentation.json'), JSON.stringify(result, null, 2) + '\n');
  }
  if (failure) throw new Error(`Disposable Talk presentation proof failed: ${safeError(failure)}`);
  assert.equal(result.status, 'PASS', 'presentation and browser cleanup must both pass');
  return result;
}
