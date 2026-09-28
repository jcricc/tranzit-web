import * as THREE from 'three';
import { loadGltf } from './load-gltf.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { EnemyManager, animationClip } from './enemy-system.js';
import { ZombieEconomy } from './zombie-economy.js';
import { clipSpeed, crossedAttackNotifies, waveSize } from './zombie-rules.js';

const files = { idle: 'ai_zombie_idle_v1_delta', walk0: 'ai_zombie_walk_v1', walk1: 'ai_zombie_walk_v2', walk2: 'ai_zombie_walk_v3', run: 'ai_zombie_run_v2', attack: 'ai_zombie_attack_v1', death: 'ch_dazed_a_death' };
const fetchJson = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); };

class Zombie {
  constructor(manager, index, spawn) {
    this.manager = manager; this.index = index; this.kind = 'zombie';
    this.root = new THREE.Group(); this.root.name = `zombie_${index}`;
    this.modelRoot = new THREE.Group(); this.modelRoot.rotation.y = Math.PI / 2;
    this.root.add(this.modelRoot);
    this.body = SkeletonUtils.clone(manager.bodies[index % manager.bodies.length]);
    this.head = SkeletonUtils.clone(manager.heads[index % manager.heads.length]);
    // Head exports are local to j_spine4, with the exporter Z-up conversion.
    const attachment = new THREE.Group(); attachment.rotation.x = Math.PI / 2;
    attachment.add(this.head); this.body.getObjectByName('j_spine4').add(attachment);
    this.modelRoot.add(this.body);
    this.mixer = new THREE.AnimationMixer(this.body);
    this.actions = Object.fromEntries(Object.entries(manager.clips).map(([name, data]) => {
      const clip = animationClip(name, data, this.body);
      const action = this.mixer.clipAction(clip);
      if (name === 'attack' || name === 'death') { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
      return [name, action];
    }));
    this.headMixer = new THREE.AnimationMixer(this.head);
    this.headActions = Object.fromEntries(Object.entries(manager.clips).map(([name,data])=>{
      const clip=animationClip(name,{...data,bones:data.bones.filter(b=>b.name!=='j_spine4')},this.head);
      const action=this.headMixer.clipAction(clip);
      if(name==='attack'||name==='death'){action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;}
      return [name,action];
    }));
    this.hitboxes = [[15,35,14,0,33,0,'torso',1],[12,13,12,0,62,0,'head',2],[15,24,13,0,12,0,'legs',.75]].map(([w,h,d,x,y,z,region,multiplier]) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), new THREE.MeshBasicMaterial({visible:false}));
      mesh.position.set(x,y,z); mesh.userData.enemyHit={enemy:this,region,multiplier}; this.root.add(mesh); return mesh;
    });
    this.weaponId = null; this.shotsFired = 0; this.magazine = 0;
    manager.scene.add(this.root); this.spawnAt(spawn);
  }
  playAction(name) {
    if (this.visualState === name) return;
    const old=this.actions[this.visualState]; old?.fadeOut(.15); this.headActions[this.visualState]?.fadeOut(.15);
    this.visualState=name; this.visualFrameIndex=0; this.actionTime=0;
    this.actions[name].reset().fadeIn(.15).play();this.headActions[name].reset().fadeIn(.15).play();
  }
  spawnAt(spawn) {
    if(this.agent) this.manager.navigation.crowd.removeAgent(this.agent);
    this.barrierPassed=false;this.barrierTime=0;
    this.spawnPoint=spawn; this.root.position.copy(spawn.position); this.root.visible=true;
    this.maxHealth=100+50*(this.manager.round-1); this.health=this.maxHealth;
    this.dead=false;this.state='chase';this.engaged=true;this.currentTarget=this.manager.player;
    this.moveClip=this.manager.round>=5 && this.index%3===0?'run':`walk${this.index%3}`;
    this.speed=clipSpeed(this.manager.clips[this.moveClip]);
    this.agent=this.manager.navigation.addAgent(spawn.position,{radius:15,height:70,maxSpeed:this.speed,maxAcceleration:160,separationWeight:3});
    this.repath=0;this.age=0;this.visualState=null;this.playAction('idle');
  }
  teleport(position) {
    const p=this.manager.navigation.projectPoint(position); if(!p.success)return false;
    this.barrierPassed=true;this.agent?.teleport(p.point);this.root.position.copy(p.point);this.repath=0;return true;
  }
  takeDamage(amount,hit=null,source=null,kind='bullet') {
    if(this.dead)return 0;
    const damage=Math.min(this.health,Math.max(0,Number(amount)||0));this.health-=damage;
    if(source===this.manager.player)this.manager.economy.damage({damage,killed:this.health<=0,headshot:hit?.object?.userData?.enemyHit?.region==='head',kind});
    if(this.health<=0){this.dead=true;this.state='dead';this.age=0;this.playAction('death');this.manager.navigation.crowd.removeAgent(this.agent);this.agent=null;this.manager.onDeath?.(this,source);}
    return damage;
  }
  update(dt) {
    this.age+=dt;
    if(this.dead){this.mixer.update(dt);this.headMixer.update(dt); if(this.age>8)this.root.visible=false;return;}
    const previous=this.root.position.clone();
    this.root.position.copy(this.agent.position());
    if(this.manager.interactions?.blockMovement(previous,this.root.position)){this.root.position.copy(previous);this.agent.teleport(previous);}
    if(this.manager.interactions?.zombieBarrier(this,dt)){this.mixer.update(dt);this.headMixer.update(dt);this.root.updateMatrixWorld(true);return;}
    const target=this.manager.player.feetPosition;
    const delta=target.clone().sub(this.root.position);
    const distance=Math.hypot(delta.x,delta.z);
    this.root.rotation.y=Math.atan2(-delta.x,-delta.z);
    const contact=distance<65 && Math.abs(delta.y)<55 && this.manager.canSeeTarget(this,this.manager.player,-1);
    this.playerVisible=contact;
    if(this.visualState==='attack'){
      const before=this.actionTime;this.actionTime+=dt;
      if(contact && !this.manager.playerHealth.dead){
        for(const notify of crossedAttackNotifies(this.manager.clips.attack,before,this.actionTime)){
          if(this.manager.playerHealth.takeDamage(35,this)>0)this.manager.meleeHits++;
        }
      }
      if(this.actionTime>=this.manager.clips.attack.duration)this.playAction('idle');
    }else if(contact && !this.manager.playerHealth.dead){
      this.agent.resetMoveTarget();this.state='attack';this.playAction('attack');
    }else{
      this.state='chase';this.repath-=dt;
      if(this.repath<=0){let destination=target;
        const barrier=this.manager.interactions?.barrierById.get(this.spawnPoint.entry);
        if(barrier?.remaining>0&&!this.barrierPassed){
          const offset=this.spawnPoint.position.clone().sub(barrier.root.position).setY(0).normalize().multiplyScalar(65);
          destination=barrier.root.position.clone().add(offset);
        }
        const p=this.manager.navigation.projectPoint(destination,{halfExtents:{x:100,y:160,z:100}});if(p.success)this.agent.requestMoveTarget(p.point);this.repath=.6;}
      const velocity=this.agent.velocity();this.movementSpeed=Math.hypot(velocity.x,velocity.z);
      this.playAction(this.movementSpeed>2?this.moveClip:'idle');
      this.actions[this.visualState].timeScale=this.visualState==='idle'?1:Math.min(1.3,this.movementSpeed/Math.max(1,this.speed));
    }
    this.headActions[this.visualState].timeScale=this.actions[this.visualState].timeScale;
    this.mixer.update(dt);this.headMixer.update(dt);this.visualFrameIndex=Math.floor(this.actions[this.visualState].time*30);
    this.root.updateMatrixWorld(true);
  }
  eyePosition(result=new THREE.Vector3()){return result.copy(this.root.position).add(new THREE.Vector3(0,60,0));}
}

export class ZombieManager extends EnemyManager {
  constructor(options){super(options);this.mode='zombies';this.economy=new ZombieEconomy();this.round=1;this.meleeHits=0;this.waveDelay=0;this.spawnCursor=0;}
  async load(){
    const manager=new THREE.LoadingManager();
    manager.setURLModifier(url=>url.endsWith('.dds')?`zombies/textures/${url.replaceAll('\\','/').split('/').at(-1).slice(0,-4)}.png`:url);
    const loader=new GLTFLoader(manager);
    const model=async name=>(await loadGltf(loader,`zombies/${name}.glb`)).scene;
    [this.bodies,this.heads,this.spawnData,this.clips]=await Promise.all([
      Promise.all([1,2,3].map(n=>model(`c_zom_zombie${n}_body01`))),
      Promise.all(['a','k'].map(n=>model(`c_zom_zombie_head_${n}`))),
      fetchJson('zombies/spawns.json'),
      Promise.all(Object.entries(files).map(async([key,name])=>[key,await fetchJson(`zombies/anims/${name}.json`)])).then(Object.fromEntries),
    ]);
    this.spawnCandidates=this.spawnData.flatMap(s=>{
      const authoredPosition=new THREE.Vector3(...s.position);
      const p=this.navigation.projectPoint(authoredPosition,{halfExtents:{x:96,y:160,z:96}});
      return p.success?[{...s,authoredPosition,position:p.point,classname:'zombie_spawn',yaw:s.yaw*Math.PI/180}]:[];
    });
    this.prepareWave();return this;
  }
  chooseSpawn(){
    const player=this.player.feetPosition;
    const nearby=this.spawnCandidates.filter(s=>s.position.distanceTo(player)>120).sort((a,b)=>a.position.distanceToSquared(player)-b.position.distanceToSquared(player)).slice(0,10);
    const reachable=nearby.filter(s=>{const path=this.navigation.findPath(s.position,player);return path.success&&path.path.at(-1)?.distanceTo(player)<100;});
    const candidates=reachable.length?reachable:nearby;
    const closest=candidates[0]?.position.distanceTo(player)??0;
    const choices=candidates.filter(s=>s.position.distanceTo(player)<=Math.max(2000,closest+600));
    if(!choices.length)throw new Error('No authored zombie spawn is usable on the navmesh');
    return choices[this.spawnCursor++%choices.length];
  }
  prepareWave(){
    const count=waveSize(this.round);
    for(let i=0;i<count;i++){
      const spawn=this.chooseSpawn();
      if(this.enemies[i])this.enemies[i].spawnAt(spawn);else this.enemies.push(new Zombie(this,i,spawn));
    }
    this.waveDelay=0;
  }
  respawnFor(){return this.chooseSpawn();}
  alert(){
    // Zombies already pursue the player; gunfire only refreshes their route.
    for(const zombie of this.enemies){
      if(zombie.dead)continue;
      zombie.currentTarget=this.player;zombie.engaged=true;zombie.repath=0;
    }
  }
  // Player respawns keep the original human start; never use a zombie window.
  safeSpawnFor(){return null;}
  update(dt,{active=true}={}){
    if(!active)return;
    for(const zombie of this.enemies)zombie.update(dt);
    if(this.aliveCount===0){this.waveDelay+=dt;if(this.waveDelay>=7){this.round++;this.prepareWave();}}
  }
  getState(){return {economy:this.economy.getState(),mode:this.mode,round:this.round,alive:this.aliveCount,meleeHits:this.meleeHits,authoredSpawns:this.spawnData.length,usableSpawns:this.spawnCandidates.length,spawnPolicy:'nearby authored markers, navmesh projected',originalAnimations:Object.values(files)};}
}
