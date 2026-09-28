import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { clipSpeed, crossedAttackNotifies, waveSize } from '../export/web/zombie-rules.js';
const read = name => JSON.parse(fs.readFileSync(new URL(`../export/web/zombies/anims/${name}.json`,import.meta.url)));
test('original walk root motion sets a slow shambling pace',()=>{
  const clip=read('ai_zombie_walk_v1');
  assert.ok(clipSpeed(clip)>37 && clipSpeed(clip)<39);
  assert.ok(clipSpeed(read('ai_zombie_run_v2'))>clipSpeed(clip)*2);
});
test('damage only occurs as the original attack fire notifies cross',()=>{
  const clip=read('ai_zombie_attack_v1');
  assert.equal(crossedAttackNotifies(clip,0,.8).length,0);
  assert.equal(crossedAttackNotifies(clip,.8,.9).length,1);
  assert.equal(crossedAttackNotifies(clip,.9,1.4).length,1);
  assert.equal(crossedAttackNotifies(clip,1.4,1.8).length,0);
});
test('waves remain below the navigation crowd capacity',()=>{
  assert.equal(waveSize(1),6);assert.equal(waveSize(2),8);assert.equal(waveSize(99),24);
});
