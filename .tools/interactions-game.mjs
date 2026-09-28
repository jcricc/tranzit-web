import path from 'node:path';
export async function runInteractionsTest(page,dir){
  const setup=await page.evaluate(()=>{
    const a=globalThis.hijacked;a.debug.setEnemiesActive(false);
    a.debug.teleportPlayer([-6880,-54,-5160]);a.debug.lookAt([-6880,0,-4900]);a.debug.resume();
    const ray=a.camera.getWorldDirection(a.camera.position.clone());
    return a.debug.getState();
  });
  await page.keyboard.press('f');
  const denied=await page.evaluate(()=>globalThis.hijacked.debug.getState());
  await page.screenshot({path:path.join(dir,'door-locked.png')});
  const closed=await page.evaluate(()=>{
    const a=globalThis.hijacked;a.debug.pause();
    for(let i=0;i<120;i++)a.player.update(1/60,{forward:1});
    const feet=a.player.feetPosition.toArray();
    a.debug.teleportPlayer([-6880,-54,-5140]);a.debug.lookAt([-6880,0,-4900]);
    for(const e of a.enemies.enemies.slice(0,5))e.takeDamage(10000,null,a.player);
    a.debug.resume();return {feet,points:a.enemies.economy.points};
  });
  await page.keyboard.press('f');
  const bought=await page.evaluate(()=>globalThis.hijacked.debug.getState());
  await page.waitForTimeout(1000);
  await page.screenshot({path:path.join(dir,'door-open.png')});
  const opened=await page.evaluate(()=>{
    const a=globalThis.hijacked;a.debug.pause();
    for(let i=0;i<120;i++)a.player.update(1/60,{forward:1});
    const feet=a.player.feetPosition.toArray();
    a.debug.teleportPlayer([-6880,-54,-5140]);a.debug.lookAt([-6880,0,-4900]);a.debug.resume();return {feet};
  });
  await page.keyboard.press('f');
  const repeatPoints=await page.evaluate(()=>globalThis.hijacked.enemies.economy.points);
  const damaged=await page.evaluate(()=>{
    const a=globalThis.hijacked,i=a.zombieInteractions,b=i.barrierById.get('depot_baricade1'),z=a.enemies.enemies[5];
    z.spawnPoint={...z.spawnPoint,entry:b.id};z.root.position.copy(b.root.position).add({x:-70,y:-28,z:0});z.barrierPassed=false;
    for(let t=0;t<300;t++)i.zombieBarrier(z,1/60);
    a.debug.teleportPlayer([-6975,-54,-5521]);a.debug.lookAt(b.center.toArray());a.debug.resume();
    return {boards:b.remaining,points:a.enemies.economy.points};
  });
  await page.screenshot({path:path.join(dir,'barrier-damaged.png')});
  await page.keyboard.down('f');
  await page.waitForFunction(()=>globalThis.hijacked.zombieInteractions.barrierById.get('depot_baricade1').remaining===6,null,{timeout:25000});
  await page.keyboard.up('f');
  const repaired=await page.evaluate(()=>globalThis.hijacked.debug.getState());
  await page.screenshot({path:path.join(dir,'barrier-repaired.png')});
  await page.evaluate(()=>globalThis.hijacked.debug.pause());
  const isOpen=s=>s.interactions.doors.find(d=>d.id==='busstop_doors').open;
  return {setup,denied,closed,bought,opened,repeatPoints,damaged,repaired,checks:{
    startsWith500:setup.zombies.economy.points===500,
    insufficientFundsRejected:!isOpen(denied)&&denied.zombies.economy.points===500,
    combatEarnsPoints:closed.points===800,
    purchaseDeductsOnce:isOpen(bought)&&bought.zombies.economy.points===50&&repeatPoints===50,
    closedDoorBlocks:closed.feet[2]<-5060,
    purchasedDoorAllowsPassage:opened.feet[2]>-5020,
    zombiesRemoveBoards:damaged.boards<6,
    holdingFRepairs:repaired.interactions.barriers.find(b=>b.id==='depot_baricade1').boards===6,
    repairAwardsPoints:repaired.zombies.economy.points>damaged.points,
  }};
}
