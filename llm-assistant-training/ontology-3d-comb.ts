import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';

// ─── Data types ───
interface GraphNode {
  id: string;
  label: string;
  color: string;
  group: string;
  title: string;
  size: number;
}
interface GraphLink {
  source: string;
  target: string;
  label: string;
  color: string;
}
interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// ─── Load embedded graph data ───
// @ts-ignore - injected at build time
import graphDataRaw from './graph-data.json';
const graphData: GraphData = graphDataRaw as GraphData;

// ─── Hex node factory ───
function makeHexNode(node: GraphNode): THREE.Group {
  const group = new THREE.Group();
  const r = Math.max(4, (node.size || 6) * 1.5);

  // Hexagonal prism (comb cell) — taller for more 3D depth
  const geo = new THREE.CylinderGeometry(r, r, r * 0.8, 6);
  geo.rotateX(Math.PI / 2);

  const mat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(node.color),
    transparent: true,
    opacity: 0.9,
    emissive: new THREE.Color(node.color),
    emissiveIntensity: 0.4,
  });
  const mesh = new THREE.Mesh(geo, mat);

  // White edge wireframe for visibility
  const edges = new THREE.EdgesGeometry(geo);
  mesh.add(new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })
  ));

  group.add(mesh);

  // Floating text label (sprite, always faces camera, depthTest=false so always visible)
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fs = 56;
  ctx.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
  const textWidth = Math.ceil(ctx.measureText(node.label).width);
  const w = textWidth + 24;
  const h = fs + 18;
  canvas.width = w;
  canvas.height = h;

  // Dark pill background
  ctx.fillStyle = 'rgba(10, 15, 30, 0.85)';
  const rr = 10;
  ctx.beginPath();
  ctx.moveTo(rr, 0);
  ctx.lineTo(w - rr, 0);
  ctx.quadraticCurveTo(w, 0, w, rr);
  ctx.lineTo(w, h - rr);
  ctx.quadraticCurveTo(w, h, w - rr, h);
  ctx.lineTo(rr, h);
  ctx.quadraticCurveTo(0, h, 0, h - rr);
  ctx.lineTo(0, rr);
  ctx.quadraticCurveTo(0, 0, rr, 0);
  ctx.closePath();
  ctx.fill();

  // Label text
  ctx.fillStyle = '#e2e8f0';
  ctx.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(node.label, 12, h / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })
  );
  // Bigger labels — 12 units tall, proportional width
  const labelScale = 16;
  sprite.scale.set((w / h) * labelScale, labelScale, 1);
  sprite.position.y = (node.size || 6) * 1.5 + 6;
  // Render on top of everything
  sprite.renderOrder = 999;
  group.add(sprite);

  return group;
}

// ─── Main ───
function main(): void {
  const el = document.getElementById('graph')!;

  // Stats
  document.getElementById('stats')!.innerHTML =
    `<span>${graphData.nodes.length} nodes</span>` +
    `<span>${graphData.links.length} links</span>` +
    `<span>51 patterns</span><span>31 threats</span>`;

  const graph = new ForceGraph3D(el, {
    graphData,
    backgroundColor: '#0a0f1e',
    showNavInfo: false,
    nodeThreeObject: makeHexNode,
    nodeThreeObjectExtend: false,
    linkColor: (l: any) =>
      l.label && /\d/.test(l.label) ? '#fbbf24' : (l.color || '#64748b'),
    linkWidth: (l: any) =>
      l.label && /\d/.test(l.label) ? 1.5 : 0.8,
    linkOpacity: 0.7,
    linkDirectionalArrowLength: 4,
    linkDirectionalArrowRelPos: 0.9,
    linkLabel: (l: any) => l.label || '',
    cooldownTicks: 400,
    warmupTicks: 150,
  });

  // @ts-ignore - width/height accept numbers
  graph.width(window.innerWidth).height(window.innerHeight - 52);

  // Force initial render so graph appears without needing a button click
  graph.refresh();
  graph.cooldownTicks(400);

  // Lighting — full THREE access now!
  const scene = graph.scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dl1 = new THREE.DirectionalLight(0xffffff, 0.6);
  dl1.position.set(0, 1, 2);
  scene.add(dl1);
  const dl2 = new THREE.DirectionalLight(0x60a5fa, 0.3);
  dl2.position.set(-2, -1, 0);
  scene.add(dl2);

  // ─── Click → sidebar details ───
  const nodeMap: Record<string, GraphNode> = {};
  graphData.nodes.forEach((n) => { nodeMap[n.id] = n; });

  graph.onNodeClick((node: any) => {
    const connected = graphData.links.filter(
      (l) => l.source === node.id || l.target === node.id
    );
    let html =
      `<div class="ic"><div class="l">Node</div>` +
      `<div class="v" style="font-weight:600;font-size:13px">${node.label}</div></div>`;
    if (node.title)
      html += `<div class="ic"><div class="l">Description</div><div class="v">${node.title}</div></div>`;
    if (connected.length > 0) {
      html += `<div class="ic"><div class="l">Connected (${connected.length})</div>`;
      connected.forEach((e) => {
        const src = nodeMap[e.source] || { label: e.source };
        const tgt = nodeMap[e.target] || { label: e.target };
        const dir = e.source === node.id ? ` → ${tgt.label}` : ` ← ${src.label}`;
        html += `<div style="margin:2px 0;color:#64748b">${e.label || 'related'} <span style="color:#e2e8f0">${dir}</span></div>`;
      });
      html += '</div>';
    }
    document.getElementById('sidebar-content')!.innerHTML = html;
    document.getElementById('sidebar')!.classList.add('open');
  });

  // ─── Filter buttons ───
  document.querySelectorAll<HTMLButtonElement>('#controls .btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#controls .btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const g = btn.dataset.group;
      if (g === 'all') { graph.graphData(graphData); return; }
      const keep = new Set<string>();
      graphData.nodes.forEach((n) => { if (n.group === g) keep.add(n.id); });
      graphData.links.forEach((l) => {
        if (keep.has(l.source)) keep.add(l.target);
        if (keep.has(l.target)) keep.add(l.source);
      });
      graph.graphData({
        nodes: graphData.nodes.filter((n) => keep.has(n.id)),
        links: graphData.links.filter((l) => keep.has(l.source) && keep.has(l.target)),
      });
    });
  });

  // ─── Search ───
  document.getElementById('search')!.addEventListener('input', (e) => {
    const q = (e.target as HTMLInputElement).value.toLowerCase();
    if (q === '') { graph.graphData(graphData); return; }
    const visNodes = graphData.nodes.filter(
      (n) => n.label.toLowerCase().includes(q) || (n.title && n.title.toLowerCase().includes(q))
    );
    const visIds = new Set(visNodes.map((n) => n.id));
    graph.graphData({
      nodes: visNodes,
      links: graphData.links.filter((l) => visIds.has(l.source) && visIds.has(l.target)),
    });
  });

  // ─── Resize ───
  window.addEventListener('resize', () => {
    // @ts-ignore
    graph.width(window.innerWidth).height(window.innerHeight - 52);
  });
}

main();