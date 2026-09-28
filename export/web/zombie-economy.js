export class ZombieEconomy {
  constructor() { this.reset(); }
  reset() { this.points=500; this.earned=0; this.spent=0; this.repairPoints=0; this.round=1; }
  add(amount) { const n=Math.max(0,Math.floor(amount));this.points+=n;this.earned+=n;return n; }
  spend(cost) { if(!Number.isInteger(cost)||cost<0||cost>this.points)return false;this.points-=cost;this.spent+=cost;return true; }
  damage({damage,killed,headshot=false,kind='bullet'}) {
    if(!(damage>0))return 0;
    return this.add(killed ? (kind==='melee'?130:kind==='explosion'?50:headshot?100:60) : kind==='explosion'?0:10);
  }
  repair(round) {
    if(round!==this.round){this.round=round;this.repairPoints=0;}
    const reward=Math.min(10,Math.max(0,Math.min(490,50+40*(round-1))-this.repairPoints));
    this.repairPoints+=reward;return this.add(reward);
  }
  getState(){return {points:this.points,earned:this.earned,spent:this.spent,repairPoints:this.repairPoints};}
}
