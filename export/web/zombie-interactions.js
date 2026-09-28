import * as THREE from 'three';
import { loadGltf } from './load-gltf.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import { CollisionWorld } from './collision-world.js';

const radians=THREE.MathUtils.degToRad;
export class ZombieInteractions {
  constructor({scene,player,camera,collisionWorld,zombies}) {
    Object.assign(this,{scene,player,camera,collisionWorld,zombies});this.economy=zombies.economy;
    this.doors=[];this.barriers=[];this.cooldown=0;this.message='';this.messageTime=0;
    this.root=new THREE.Group();this.root.name='zombie_interactions';scene.add(this.root);
    this.hud=document.createElement('div');this.hud.id='zombie-interaction-hud';
    this.hud.style.cssText='position:fixed;left:50%;bottom:22%;transform:translateX(-50%);color:#fff;text-shadow:0 2px 4px #000;font:600 18px system-ui;text-align:center;pointer-events:none;z-index:15';document.body.append(this.hud);
  }
  async load() {
    const r=await fetch('interactions/tranZit.json');if(!r.ok)throw new Error('TranZit interactions unavailable');
    const data=await r.json();const manager=new THREE.LoadingManager();
    manager.setURLModifier(url=>url.endsWith('.dds')?`interactions/textures/${url.replaceAll('\\','/').split('/').at(-1).replace(/^,/,'').slice(0,-4)}.png`:url);
    const loader=new GLTFLoader(manager),textures=new THREE.TextureLoader(),cache=new Map();
    const loadModel=name=>{if(!cache.has(name))cache.set(name,loadGltf(loader,`interactions/${name}.glb`));return cache.get(name);};
    for(const def of data.doors){
      const door={...def,open:false,parts:[],anchors:def.triggers.map(p=>new THREE.Vector3(...p)),colliders:[]};
      for(const part of def.parts){
        const root=new THREE.Group();
        if(part.groups){
          for(const group of part.groups){
            if(!group.position.length)continue;
            const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(group.position,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(group.uv,2));geometry.computeVertexNormals();
            const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9,side:THREE.DoubleSide});
            if(group.texture){material.map=await textures.loadAsync(`textures/zm_transit/${group.texture}.png`);material.map.colorSpace=THREE.SRGBColorSpace;}
            root.add(new THREE.Mesh(geometry,material));
          }
        }else root.add(SkeletonUtils.clone((await loadModel(part.model)).scene));
        const localBounds=new THREE.Box3().setFromObject(root),size=localBounds.getSize(new THREE.Vector3()),center=localBounds.getCenter(new THREE.Vector3());
        if(!localBounds.isEmpty()){
          const collider=new THREE.Mesh(new THREE.BoxGeometry(Math.max(size.x,5),Math.max(size.y,5),Math.max(size.z,5)));collider.position.copy(center);root.add(collider);collider.visible=false;door.colliders.push(collider);
        }
        root.position.fromArray(part.position);root.rotation.y=radians(part.angles[1]);
        root.userData.closedYaw=root.rotation.y;
        const yaw=radians(part.openAngles?.[1]||100);root.userData.openYaw=root.rotation.y+Math.atan2(Math.sin(yaw),Math.cos(yaw));
        this.root.add(root);door.parts.push(root);
        door.anchors.push(new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3()));
      }
      this.doors.push(door);
    }
    const woodMap=await textures.loadAsync('textures/zm_transit/~-gp6_wood_plank_rustic01_c.png');woodMap.colorSpace=THREE.SRGBColorSpace;
    const wood=new THREE.MeshStandardMaterial({color:0xffffff,map:woodMap,roughness:1});
    // Small planks remain separate so repairs visibly restore one board at a time.
    for(const def of data.barriers){
      const root=new THREE.Group();root.position.fromArray(def.position);root.rotation.y=radians(def.yaw);this.root.add(root);
      const boards=[];
      for(let i=0;i<def.count;i++){
        const mesh=new THREE.Mesh(new THREE.BoxGeometry(94,9,3),wood);mesh.position.set((i%2?1:-1)*3,i*11,0);mesh.rotation.z=radians(i%2?7:-6);root.add(mesh);boards.push(mesh);
      }
      const collider=new THREE.Mesh(new THREE.BoxGeometry(98,72,8));collider.position.y=26;collider.visible=false;root.add(collider);
      this.barriers.push({...def,root,boards,collider,remaining:def.count,tearTime:0,center:root.position.clone().add(new THREE.Vector3(0,25,0))});
    }
    this.barrierById=new Map(this.barriers.map(b=>[b.id,b]));this.rebuildCollision();return this;
  }
  rebuildCollision(){
    const vertices=[];this.root.updateMatrixWorld(true);
    const meshes=[...this.doors.filter(d=>!d.open).flatMap(d=>d.colliders),...this.barriers.filter(b=>b.remaining>0).map(b=>b.collider)];
    for(const mesh of meshes){
      const g=mesh.geometry,p=g.attributes.position,idx=g.index,v=new THREE.Vector3();
      for(let i=0;i<(idx?idx.count:p.count);i++){v.fromBufferAttribute(p,idx?idx.getX(i):i).applyMatrix4(mesh.matrixWorld);vertices.push(v.x,v.y,v.z);}
    }
    const old=this.collisionWorld.dynamicWorld;if(old){old.geometry.dispose();old.mesh.material.dispose();}
    if(vertices.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));this.collisionWorld.dynamicWorld=new CollisionWorld(g);}else this.collisionWorld.dynamicWorld=null;
  }
  select(){
    const eye=this.camera.position,forward=this.camera.getWorldDirection(new THREE.Vector3());let best=null;
    const check=(kind,item,point)=>{const delta=point.clone().sub(eye),distance=delta.length();if(distance>115||forward.dot(delta.normalize())<.25)return;if(!best||distance<best.distance)best={kind,item,distance};};
    for(const door of this.doors)if(!door.open)for(const point of door.anchors)check('door',door,point);
    for(const barrier of this.barriers)check('barrier',barrier,barrier.center);
    return best;
  }
  say(message){this.message=message;this.messageTime=1.5;}
  press(){
    const target=this.select();if(!target)return false;
    if(target.kind==='door'){
      const door=target.item;if(!this.economy.spend(door.cost)){this.say(`Need ${door.cost-this.economy.points} more points`);return false;}
      door.open=true;this.rebuildCollision();this.say(`Door opened -${door.cost}`);return true;
    }
    return this.repair(target.item);
  }
  repair(barrier){
    if(this.cooldown>0||barrier.remaining>=barrier.count)return false;
    barrier.boards[barrier.remaining++].visible=true;
    const reward=this.economy.repair(this.zombies.round);this.cooldown=.7;this.rebuildCollision();this.say(reward?`Barrier repaired +${reward}`:'Barrier repaired');return true;
  }
  tear(barrier){
    if(!barrier||barrier.remaining<=0)return false;
    barrier.boards[--barrier.remaining].visible=false;this.rebuildCollision();return true;
  }
  blockMovement(previous,next){
    const world=this.collisionWorld.dynamicWorld;if(!world)return false;
    const capsule=new Capsule(next.clone().add(new THREE.Vector3(0,16,0)),next.clone().add(new THREE.Vector3(0,56,0)),15);
    return Boolean(world.capsuleIntersect(capsule));
  }
  zombieBarrier(zombie,dt){
    const barrier=this.barrierById.get(zombie.spawnPoint.entry);
    if(!barrier||barrier.remaining===0||zombie.barrierPassed)return false;
    if(zombie.root.position.distanceTo(barrier.root.position)>115)return false;
    zombie.agent.resetMoveTarget();zombie.state='barrier';zombie.playAction('attack');
    zombie.root.rotation.y=Math.atan2(zombie.root.position.x-barrier.center.x,zombie.root.position.z-barrier.center.z);
    zombie.barrierTime=(zombie.barrierTime??0)+dt;
    if(zombie.barrierTime>=1.6){this.tear(barrier);zombie.barrierTime=0;zombie.visualState=null;zombie.playAction('attack');}
    if(barrier.remaining===0){zombie.barrierPassed=true;zombie.repath=0;}
    return true;
  }
  update(dt,{active,held}){
    if(!active){this.hud.textContent='';return;}
    this.cooldown=Math.max(0,this.cooldown-dt);this.messageTime=Math.max(0,this.messageTime-dt);
    for(const door of this.doors)if(door.open)for(const root of door.parts)root.rotation.y=THREE.MathUtils.damp(root.rotation.y,root.userData.openYaw,7,dt);
    const target=this.select();if(held&&target?.kind==='barrier')this.repair(target.item);
    const hint=target?.kind==='door'?`F - Open door [${target.item.cost}]`:target?.kind==='barrier'?(target.item.remaining<target.item.count?`Hold F - Rebuild barrier (${target.item.remaining}/${target.item.count})`:'Barrier repaired (6/6)'):'';
    this.hud.textContent=this.messageTime>0?this.message:hint;
  }
  getState(){return {economy:this.economy.getState(),doors:this.doors.map(d=>({id:d.id,cost:d.cost,open:d.open,position:d.anchors[0].toArray()})),barriers:this.barriers.map(b=>({id:b.id,boards:b.remaining,position:b.center.toArray()})),prompt:this.hud.textContent};}
}
