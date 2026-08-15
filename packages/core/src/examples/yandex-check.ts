/**
 * Verifies the Yandex plugin's plumbing without involving the deck at all.
 *
 * Run with:  pnpm --filter @easydeck/core yandex-check
 *
 * Signs in if it has to — a link opens, confirm it on a phone — then finds the
 * speakers on the network, joins them to the names and rooms the account
 * knows, and listens to each one for a few seconds. Nothing is played, moved
 * or spoken: the only thing sent is the keepalive.
 *
 * What this separates: a plugin that shows nothing because the speakers cannot
 * be reached, from one that shows nothing because the deck is not asking.
 *
 * Set YANDEX_X_TOKEN to skip the sign-in on later runs; the token it prints is
 * the one to put there.
 */
import { GlagolConnection } from '../infrastructure/plugins/yandex/glagol-connection.js';
import { discoverSpeakers, localAddresses } from '../infrastructure/plugins/yandex/glagol-discovery.js';
import {
  accountName,
  beginLogin,
  cloudSpeakers,
  deviceToken,
  musicToken,
} from '../infrastructure/plugins/yandex/yandex-account.js';

const LISTEN_SECONDS = 10;

async function main(): Promise<void> {
  console.log(`Interfaces: ${localAddresses().join(', ')}\n`);

  const xToken = process.env['YANDEX_X_TOKEN'] ?? (await signIn());
  const music = await musicToken(xToken);
  console.log(`Signed in as ${await accountName(xToken).catch(() => '?')}\n`);

  const [onNetwork, inAccount] = await Promise.all([
    discoverSpeakers(),
    cloudSpeakers(xToken, music),
  ]);

  console.log(`On the network: ${onNetwork.length}, in the account: ${inAccount.length}\n`);

  const listening: Promise<void>[] = [];

  for (const local of onNetwork) {
    const known = inAccount.find((speaker) => speaker.deviceId === local.deviceId);
    const where = known ? [known.room, known.name].filter(Boolean).join(' · ') : '(not in this account)';
    console.log(`${where}  ${local.platform}  ${local.host}:${local.port}`);

    if (!known) continue;

    try {
      const token = await deviceToken(music, local.deviceId, local.platform);
      listening.push(listen(local.host, local.port, token, where));
    } catch (error) {
      console.log(`   no token: ${(error as Error).message}`);
    }
  }

  console.log(`\nListening for ${LISTEN_SECONDS}s…\n`);
  await Promise.all(listening);
}

/** Opens the confirmation link and waits for a phone to say yes. */
async function signIn(): Promise<string> {
  const pending = await beginLogin();
  console.log('Confirm this on your phone, or open it in a browser signed in to Yandex:');
  console.log(`  ${pending.link}\n`);

  const xToken = await pending.confirm();
  console.log(`YANDEX_X_TOKEN=${xToken}\n`);
  return xToken;
}

/** Prints what one speaker says, and only when it says something new. */
function listen(host: string, port: number, token: string, name: string): Promise<void> {
  return new Promise((done) => {
    let last = '';

    const connection = new GlagolConnection({
      host,
      port,
      token: () => token,
      onConnection: (state, message) => {
        if (state !== 'ready') console.log(`   ${name}: ${state} ${message ?? ''}`);
      },
      onState: (state) => {
        const player = state.playerState;
        const line = [
          state.playing ? 'playing' : 'paused',
          `vol ${Math.round((state.volume ?? 0) * 100)}%`,
          player ? `"${player.title}" — ${player.subtitle}` : 'nothing loaded',
          player?.extra?.coverURI ? 'has art' : '',
        ]
          .filter(Boolean)
          .join('  ');

        if (line === last) return;
        last = line;
        console.log(`   ${name}: ${line}`);
      },
    });

    connection.start();
    setTimeout(() => {
      connection.stop();
      done();
    }, LISTEN_SECONDS * 1000);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
