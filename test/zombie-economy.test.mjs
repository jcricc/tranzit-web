import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Capsule} from 'three/addons/math/Capsule.js';
import {ZombieEconomy} from '../export/web/zombie-economy.js';
import {CollisionWorld} from '../export/web/collision-world.js';
test('points distinguish hits, kill type, and rejected purchases',()=>{
  const e=new ZombieEconomy();assert.equal(e.points,500);assert.equal(e.spend(750),false);assert.equal(e.points,500);
  assert.equal(e.damage({damage:20,killed:false}),10);
  assert.equal(e.damage({damage:80,killed:true,headshot:true}),100);
  assert.equal(e.damage({damage:100,killed:true,kind:'melee'}),130);
  assert.equal(e.damage({damage:100,killed:true}),60);
  assert.equal(e.damage({damage:0,killed:true}),0);
  assert.equal(e.spend(750),true);assert.equal(e.points,50);assert.equal(e.spend(-1),false);
});
test('repair reward cap resets with the round and prevents unlimited farming',()=>{
  const e=new ZombieEconomy();for(let i=0;i<10;i++)e.repair(1);assert.equal(e.points,550);
  assert.equal(e.repair(2),10);assert.equal(e.repairPoints,10);
});
test('dynamic doors obstruct capsules and rays until removed',()=>{
  const world=new CollisionWorld(new THREE.BoxGeometry(10,100,100).translate(500,0,0));
  world.dynamicWorld=new CollisionWorld(new THREE.BoxGeometry(10,100,100));
  const capsule=new Capsule(new THREE.Vector3(6,-10,0),new THREE.Vector3(6,10,0),4);
  assert.ok(world.capsuleIntersect(capsule));
  const ray=new THREE.Ray(new THREE.Vector3(-100,0,0),new THREE.Vector3(1,0,0));
  const hit=world.rayIntersect(ray);assert.equal(hit.distance,95);assert.equal(hit.triangle.a.x,-5);
  world.dynamicWorld=null;
  assert.equal(world.capsuleIntersect(capsule),false);assert.equal(world.raycastFirst(ray).distance,595);
});
