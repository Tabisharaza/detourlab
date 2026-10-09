/** Original Canvas scene. Coordinates are fictional. No imagery or map services. */
const colors = { lime: '#c4f574', teal: '#48bdb5', red: '#f68170' };
const hash = (x, y) => { let n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return (n >>> 0) / 4294967296; };
const distanceToSegment = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };

export class NetworkMap {
  constructor(canvas, state, events) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.state = state; this.events = events; this.width = 1; this.height = 1; this.dirty = true; this.vehiclePoints = [];
    this.background = document.createElement('canvas'); this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    new ResizeObserver(() => { const { width, height } = canvas.getBoundingClientRect(); this.width = width; this.height = height; this.dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.round(width * this.dpr); canvas.height = Math.round(height * this.dpr); this.dirty = true; }).observe(canvas);
    canvas.addEventListener('pointermove', (event) => { const p = this.pointer(event); const edge = this.nearestRoad(p); if (this.state.editing && edge && edge.distance < 10) this.events.onHover(`${edge.edge.roadName} · click to toggle`, p.x, p.y); else this.events.onHover('', 0, 0); });
    canvas.addEventListener('pointerleave', () => this.events.onHover('', 0, 0));
    canvas.addEventListener('click', (event) => { const p = this.pointer(event); if (this.state.editing) { const edge = this.nearestRoad(p); if (edge && edge.distance < 16) this.events.onRoad(edge.edge.id); } else { const vehicle = [...this.vehiclePoints].sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0]; if (vehicle && Math.hypot(vehicle.x - p.x, vehicle.y - p.y) < 20) this.events.onVehicle(vehicle.id); } });
  }
  pointer(event) { const rect = this.canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  invalidate() { this.dirty = true; }
  project(x, y, lift = 0) { return { x: this.offsetX + (x - y * .51) * this.scale, y: this.offsetY + (y * .64 + x * .245) * this.scale - lift }; }
  nearestRoad(p) { if (!this.edgePoints) return null; let best = null; for (const item of this.edgePoints) { const distance = distanceToSegment(p, item.a, item.b); if (!best || distance < best.distance) best = { ...item, distance }; } return best; }
  path(ctx, points, fill, stroke, width = 1) { if (!points.length) return; ctx.beginPath(); points.forEach((point, i) => i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); } }
  line(ctx, a, b, color, width = 1) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
  polygon(ctx, coords, fill, stroke, lift = 0) { this.path(ctx, coords.map(([x,y]) => this.project(x,y,lift)), fill, stroke); }
  buildScene() {
    const { scenario, zoom } = this.state;
    this.nodeMap = new Map(scenario.nodes.map(n => [n.id, n]));
    this.edgeMap = new Map(scenario.edges.map(edge => [edge.id, edge]));
    this.vehicleMap = new Map(scenario.vehicles.map(vehicle => [vehicle.id, vehicle]));
    const projected = scenario.nodes.map(n => ({ x: n.x - n.y * .51, y: n.y * .64 + n.x * .245 }));
    const minX = Math.min(...projected.map(p => p.x)), maxX = Math.max(...projected.map(p => p.x));
    const minY = Math.min(...projected.map(p => p.y)), maxY = Math.max(...projected.map(p => p.y));
    this.scale = Math.min((this.width - 55) / Math.max(maxX - minX, 1), (this.height - 75) / Math.max(maxY - minY, 1)) * zoom;
    this.offsetX = this.width / 2 - (minX + maxX) / 2 * this.scale;
    this.offsetY = this.height / 2 + 5 - (minY + maxY) / 2 * this.scale;
    this.background.width = this.canvas.width; this.background.height = this.canvas.height;
    const ctx = this.background.getContext('2d'); ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const grid = '#29445125';
    for (let i = -40; i < 70; i += 2) { this.line(ctx, this.project(i,-40), this.project(i,50), grid, .5); this.line(ctx, this.project(-40,i), this.project(60,i), grid, .5); }
    this.synthetic = scenario.id.startsWith('meridian-seed-') && scenario.nodes.length === 432 && scenario.nodes.every(n => n.id === `node-${n.x}-${n.y}` && Number.isInteger(n.x) && Number.isInteger(n.y) && n.x >= 0 && n.x <= 23 && n.y >= 0 && n.y <= 17);
    if (this.synthetic) {
      this.polygon(ctx, [[-.65,-.65],[23.65,-.65],[23.65,17.65],[-.65,17.65]], '#14242c', '#34505b88');
      this.polygon(ctx, [[11.17,-.65],[11.82,-.65],[11.82,17.65],[11.17,17.65]], '#123a47', '#21525f');
      for (let y = 0; y < 18; y += .5) { this.line(ctx, this.project(11.3,y), this.project(11.6,y+.16), '#5298a535', .7); }
      // Every building is procedural decoration, never an imported real structure.
      for (let y = 0; y < 17; y++) for (let x = 0; x < 23; x++) {
        if (x === 11) continue;
        const random = hash(x,y);
        if ((x >= 2 && x <= 4 && y >= 2 && y <= 5) || (x >= 17 && x <= 19 && y >= 11 && y <= 13)) {
          this.polygon(ctx, [[x+.15,y+.16],[x+.82,y+.16],[x+.82,y+.83],[x+.15,y+.83]], '#233d35', '#3d60503a');
          const tree = this.project(x+.5,y+.5); ctx.fillStyle = '#496b55'; ctx.beginPath(); ctx.ellipse(tree.x, tree.y-3, Math.max(1.5,this.scale*.09), Math.max(2,this.scale*.13), 0, 0, Math.PI*2); ctx.fill();
          continue;
        }
        const pad = .17 + random*.08;
        const c = [[x+pad,y+pad],[x+.85,y+pad],[x+.85,y+.82],[x+pad,y+.82]];
        const height = this.scale * (.10 + random * .50) * (x > 14 && y < 8 ? 1.45 : .65);
        const points = c.map(([a,b]) => this.project(a,b)); const top = c.map(([a,b]) => this.project(a,b,height));
        this.path(ctx, [points[2],points[3],top[3],top[2]], '#243843', '#45627130');
        this.path(ctx, [points[1],points[2],top[2],top[1]], '#1d313d', '#45627130');
        this.path(ctx, top, random > .65 ? '#344c59' : '#2b404d', '#64808b35', .55);
        if (random > .78) { const p=this.project(x+.5,y+.46,height+1); ctx.fillStyle='#6b8a9633'; ctx.fillRect(p.x-2,p.y-1,4,2); }
      }
    }
    const seen = new Set(); this.edgePoints = [];
    for (const edge of scenario.edges) {
      const key = [edge.from,edge.to].sort().join('|'); if (seen.has(key)) continue; seen.add(key);
      const from = this.nodeMap.get(edge.from), to = this.nodeMap.get(edge.to); const a=this.project(from.x,from.y), b=this.project(to.x,to.y);
      this.edgePoints.push({ edge,a,b });
      const bridge = edge.id.startsWith('bridge-');
      const major = bridge || (from.y === to.y && (from.y === 9 || from.y === 3 || from.y === 15)) || (from.x === to.x && (from.x === 6 || from.x === 17));
      this.line(ctx,a,b,bridge ? '#668490' : major ? '#506c796b' : '#3b546257', bridge ? 4 : major ? 2.1 : 1.15);
      if (bridge) { this.line(ctx,a,b,'#afbec646',.8); }
    }
    if (this.synthetic) {
      const label = (text,x,y,angle = .24) => { const p=this.project(x,y); ctx.save();ctx.translate(p.x,p.y);ctx.rotate(angle);ctx.font=`${Math.max(6,Math.min(8,this.scale*.35))}px ui-monospace, monospace`;ctx.fillStyle='#a2bbc170';ctx.textAlign='center';ctx.fillText(text,0,0);ctx.restore(); };
      label('OLD QUARTER',4,1);label('NORTH BANK',17,1);label('MARKET DISTRICT',17,9);label('SOUTH WORKS',6,16.8);label('MERIDIAN RIVER',11.5,7,1.01);
    }
    const earliest = new Map();
    for (const closure of scenario.closures) for (const id of closure.edgeIds) earliest.set(id, Math.min(earliest.get(id) ?? Infinity, closure.atS));
    this.closureGeometries = new Map();
    for (const [id, atS] of earliest) {
      const edge = this.edgeMap.get(id), key = [edge.from, edge.to].sort().join('|');
      if (!this.closureGeometries.has(key)) this.closureGeometries.set(key, []);
      this.closureGeometries.get(key).push({edge,atS});
    }
    this.dirty = false;
  }
  position(vehicle) {
    const source = this.vehicleMap.get(vehicle.id); let last = this.nodeMap.get(source.startNode);
    for (const segment of vehicle.segments) {
      const from=this.nodeMap.get(segment.from),to=this.nodeMap.get(segment.to);
      if (this.state.time < segment.startS) return this.project(from.x,from.y);
      if (this.state.time <= segment.endS) { const t=(this.state.time-segment.startS)/(segment.endS-segment.startS); return this.project(from.x+(to.x-from.x)*t,from.y+(to.y-from.y)*t); }
      last=to;
    }
    return this.project(last.x,last.y);
  }
  drawRoute(vehicle, color, dashed) {
    if (!vehicle) return; const ctx=this.ctx; ctx.save();ctx.lineJoin='round';ctx.lineCap='round';ctx.strokeStyle=color;ctx.lineWidth=dashed?2:2.7;ctx.globalAlpha=dashed?.6:.85;ctx.setLineDash(dashed?[4,4]:[]);ctx.beginPath();
    for (const segment of vehicle.segments) { const a=this.nodeMap.get(segment.from),b=this.nodeMap.get(segment.to),p=this.project(a.x,a.y),q=this.project(b.x,b.y);ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y); }
    ctx.stroke();ctx.restore();
    // Bright trail is drawn from the same ledger, up to the exact playback time.
    if (!dashed) { ctx.save();ctx.strokeStyle=color;ctx.lineWidth=3;ctx.shadowColor=color;ctx.shadowBlur=7;ctx.beginPath();for(const segment of vehicle.segments){if(segment.startS>this.state.time||segment.endS<this.state.time-90)continue;const a=this.nodeMap.get(segment.from),b=this.nodeMap.get(segment.to),t=Math.min(1,(this.state.time-segment.startS)/(segment.endS-segment.startS)),p=this.project(a.x,a.y),q=this.project(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t);ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);}ctx.stroke();ctx.restore(); }
  }
  render() {
    if (!this.width || !this.state.scenario.nodes.length) return;
    if (this.dirty) this.buildScene();
    const ctx=this.ctx;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,this.canvas.width,this.canvas.height);ctx.drawImage(this.background,0,0);ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
    const { baseline, disrupted, selectedVehicle, view, scenario, time }=this.state;
    const selected=disrupted?.vehicles.find(v=>v.id===selectedVehicle),base=baseline?.vehicles.find(v=>v.id===selectedVehicle);
    if (view==='baseline'||view==='compare') this.drawRoute(base,colors.teal,true);
    if (view!=='baseline') this.drawRoute(selected,colors.lime,false);
    // Complete synthetic demand is subdued; selected stop outcomes get stronger marks.
    for (const job of scenario.jobs) {const n=this.nodeMap.get(job.nodeId),p=this.project(n.x,n.y);ctx.beginPath();ctx.arc(p.x,p.y,1.6,0,Math.PI*2);ctx.fillStyle='#afc9d545';ctx.fill();}
    const selectedRun=view==='baseline'?base:selected;
    if (selectedRun) selectedRun.jobs.forEach((job,index)=>{const n=this.nodeMap.get(job.nodeId),p=this.project(n.x,n.y),reached=job.arrivalS!==null&&time>=job.arrivalS;ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle=reached?(job.status==='late'?colors.red:colors.teal):'#10222d';ctx.fill();ctx.strokeStyle=job.status==='unreachable'?colors.red:'#d4e7c7';ctx.lineWidth=1;ctx.stroke();if(this.scale>13){ctx.font='7px ui-monospace,monospace';ctx.fillStyle='#dbebdd';ctx.fillText(String(index+1),p.x+6,p.y-4);}});
    if (view !== 'baseline') {
      const geometries = this.closureGeometries;
      for (const records of geometries.values()) {
        const {edge} = records[0], active = records.some(record => time >= record.atS);
        const a=this.nodeMap.get(edge.from),b=this.nodeMap.get(edge.to),p=this.project(a.x,a.y),q=this.project(b.x,b.y);
        ctx.save(); ctx.strokeStyle=active?colors.red:'#d4a26b'; ctx.lineWidth=active?5:3; ctx.setLineDash(active?[]:[3,3]); ctx.shadowBlur=active?12:0; ctx.shadowColor=colors.red; this.line(ctx,p,q,ctx.strokeStyle,ctx.lineWidth); ctx.restore();
        const m={x:(p.x+q.x)/2,y:(p.y+q.y)/2}; ctx.fillStyle=active?'#4e302b':'#493b28'; ctx.beginPath(); ctx.arc(m.x,m.y,6,0,Math.PI*2); ctx.fill();
        this.line(ctx,{x:m.x-2,y:m.y-2},{x:m.x+2,y:m.y+2},active?colors.red:'#f3cb91',1.4); this.line(ctx,{x:m.x+2,y:m.y-2},{x:m.x-2,y:m.y+2},active?colors.red:'#f3cb91',1.4);
        const activeDirections = records.filter(record=>time>=record.atS);
        const displayed = activeDirections.length ? activeDirections : records;
        const both = displayed.some(record=>record.edge.from===edge.from) && displayed.some(record=>record.edge.from===edge.to);
        if (!both) {
          const direction=displayed[0].edge,from=this.nodeMap.get(direction.from),to=this.nodeMap.get(direction.to),u=this.project(from.x,from.y),v=this.project(to.x,to.y),angle=Math.atan2(v.y-u.y,v.x-u.x);
          ctx.save();ctx.translate(m.x,m.y-10);ctx.rotate(angle);ctx.fillStyle=active?colors.red:'#f3cb91';ctx.beginPath();ctx.moveTo(5,0);ctx.lineTo(-3,-3);ctx.lineTo(-3,3);ctx.closePath();ctx.fill();ctx.restore();
        }
      }
    }
    // Depots correspond to actual vehicle starting nodes.
    const depots=new Set(scenario.vehicles.map(v=>v.startNode));for(const id of depots){const n=this.nodeMap.get(id),p=this.project(n.x,n.y);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.PI/4);ctx.fillStyle='#c8f38c';ctx.strokeStyle='#142723';ctx.lineWidth=2;ctx.fillRect(-4,-4,8,8);ctx.strokeRect(-4,-4,8,8);ctx.restore();}
    this.vehiclePoints=[];
    const drawVehicles=(run,ghost)=>{if(!run)return;for(const vehicle of run.vehicles){const p=this.position(vehicle);if(!ghost)this.vehiclePoints.push({...p,id:vehicle.id});const isSelected=vehicle.id===selectedVehicle;ctx.save();ctx.globalAlpha=ghost?.45:1;ctx.beginPath();ctx.arc(p.x,p.y,isSelected?4.5:2.5,0,Math.PI*2);ctx.fillStyle=ghost?colors.teal:isSelected?colors.lime:'#bad4d6';ctx.shadowColor=isSelected?colors.lime:colors.teal;ctx.shadowBlur=isSelected?12:3;ctx.fill();ctx.shadowBlur=0;if(isSelected){ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);ctx.strokeStyle=ghost?colors.teal:'#c6f988aa';ctx.lineWidth=1;ctx.stroke();if(!ghost){ctx.font='8px ui-monospace, monospace';const text=vehicle.id.toUpperCase(),w=ctx.measureText(text).width;ctx.fillStyle='#112c25ee';ctx.fillRect(p.x+11,p.y-19,w+12,17);ctx.strokeStyle='#6b985e';ctx.strokeRect(p.x+11,p.y-19,w+12,17);ctx.fillStyle='#d4f6b6';ctx.fillText(text,p.x+17,p.y-7);}}ctx.restore();}};
    if(view==='compare')drawVehicles(baseline,true);drawVehicles(view==='baseline'?baseline:disrupted,false);
  }
}
