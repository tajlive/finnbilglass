import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byggKandidat } from '../src/vin-resolver';
const env = { FINNBILGLASS_DB: { prepare() { return { bind() { return this; }, async first() { return null; } }; } } } as any;
test('resolver prices windshield at 60 percent discount and leaves door glass at 75 percent', async () => {
 const front = await byggKandidat(env, { varenr:'5381AGACMVW1B', varenavn:'VW TRANSPORTER T5 FRONTRUTE', pris:9980, eurokode:'5381AGACMVW1B', kommentar:null }, 'FRONTRUTE_ONLY');
 assert.ok(front);
 assert.equal(front.pris, 4990);
 const door = await byggKandidat(env, { varenr:'TEST', varenavn:'VW TRANSPORTER DØRRUTE VENSTRE', pris:9980, eurokode:null, kommentar:null }, 'ALL_GLASS_CANDIDATES');
 assert.ok(door);
 assert.equal(door.pris, 3118.75);
});
