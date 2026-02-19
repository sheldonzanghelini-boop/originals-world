/**
 * Gerador de Tilesets para Originals World
 * Cria tilesets em PNG para melhorar gráficos do jogo
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

// Criar diretório de tilesets se não existir
const tilesetsDir = path.join(__dirname, 'public', 'assets', 'tilesets');
if (!fs.existsSync(tilesetsDir)) {
  fs.mkdirSync(tilesetsDir, { recursive: true });
}

// Tamanho de cada tile
const TILE_SIZE = 32;

/**
 * Desenha um tile de grama
 */
function drawGrass(ctx, x, y, seed) {
  ctx.fillStyle = '#4a8c3f';
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  
  // Sombras sutis
  ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
  if (seed % 3 === 0) ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE * 0.3);
  
  // Detalhes de grama
  ctx.fillStyle = '#5a9c4f';
  for (let i = 0; i < 3; i++) {
    const px = x + (seed * 5 + i * 11) % TILE_SIZE;
    const py = y + (seed * 7 + i * 13) % TILE_SIZE;
    ctx.fillRect(px, py, 2, 3);
  }
  
  // Borda para separação
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
}

/**
 * Desenha um tile de grama escura
 */
function drawDarkGrass(ctx, x, y, seed) {
  ctx.fillStyle = '#3d7a33';
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  
  ctx.fillStyle = '#357028';
  ctx.fillRect(x + TILE_SIZE * 0.3, y + TILE_SIZE * 0.5, TILE_SIZE * 0.15, TILE_SIZE * 0.1);
  
  if (seed % 2 === 0) {
    ctx.fillStyle = '#4a8a3a';
    ctx.fillRect(x + TILE_SIZE * 0.6, y + TILE_SIZE * 0.2, TILE_SIZE * 0.1, TILE_SIZE * 0.12);
  }
  
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
}

/**
 * Desenha um tile de flores
 */
function drawFlowers(ctx, x, y, seed) {
  drawGrass(ctx, x, y, seed);
  
  const flowerColors = ['#ff6688', '#ffaa44', '#ff4466', '#ffdd44', '#ff88cc', '#aaddff'];
  
  for (let i = 0; i < 2; i++) {
    const fx = x + TILE_SIZE * 0.25 + (seed + i) * 5 % (TILE_SIZE * 0.5);
    const fy = y + TILE_SIZE * 0.3 + (seed * 3 + i * 5) % (TILE_SIZE * 0.4);
    
    // Caule
    ctx.strokeStyle = '#3a7a2f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx, fy + TILE_SIZE * 0.15);
    ctx.stroke();
    
    // Flor
    ctx.fillStyle = flowerColors[(seed + i) % flowerColors.length];
    ctx.beginPath();
    ctx.arc(fx, fy, TILE_SIZE * 0.06, 0, Math.PI * 2);
    ctx.fill();
    
    // Centro
    ctx.fillStyle = '#ffee44';
    ctx.beginPath();
    ctx.arc(fx, fy, TILE_SIZE * 0.02, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Desenha um tile de água
 */
function drawWater(ctx, x, y, seed) {
  ctx.fillStyle = '#2d5f8d';
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  
  // Ondas
  ctx.strokeStyle = 'rgba(200, 220, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + TILE_SIZE * 0.3);
  ctx.quadraticCurveTo(x + TILE_SIZE * 0.5, y + TILE_SIZE * 0.2, x + TILE_SIZE, y + TILE_SIZE * 0.3);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(x, y + TILE_SIZE * 0.7);
  ctx.quadraticCurveTo(x + TILE_SIZE * 0.5, y + TILE_SIZE * 0.6, x + TILE_SIZE, y + TILE_SIZE * 0.7);
  ctx.stroke();
  
  // Brilho
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.fillRect(x + TILE_SIZE * 0.2, y + TILE_SIZE * 0.1, TILE_SIZE * 0.3, TILE_SIZE * 0.2);
}

/**
 * Desenha um tile de árvore
 */
function drawTree(ctx, x, y, seed) {
  // Grama base
  drawGrass(ctx, x, y, seed);
  
  // Tronco
  ctx.fillStyle = '#6b4423';
  ctx.fillRect(x + TILE_SIZE * 0.35, y + TILE_SIZE * 0.4, TILE_SIZE * 0.3, TILE_SIZE * 0.35);
  
  // Folhagem (copas da árvore)
  ctx.fillStyle = '#2d5a2d';
  ctx.beginPath();
  ctx.arc(x + TILE_SIZE * 0.5, y + TILE_SIZE * 0.25, TILE_SIZE * 0.28, 0, Math.PI * 2);
  ctx.fill();
  
  // Folhagem mais clara
  ctx.fillStyle = '#3a7a3a';
  ctx.beginPath();
  ctx.arc(x + TILE_SIZE * 0.35, y + TILE_SIZE * 0.35, TILE_SIZE * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + TILE_SIZE * 0.65, y + TILE_SIZE * 0.35, TILE_SIZE * 0.18, 0, Math.PI * 2);
  ctx.fill();
  
  // Destaque
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.beginPath();
  ctx.arc(x + TILE_SIZE * 0.35, y + TILE_SIZE * 0.15, TILE_SIZE * 0.08, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Desenha um tile de lápide/cemitério
 */
function drawGraveStone(ctx, x, y, seed) {
  drawDarkGrass(ctx, x, y, seed);
  
  // Lápide
  ctx.fillStyle = '#999999';
  ctx.beginPath();
  ctx.moveTo(x + TILE_SIZE * 0.3, y + TILE_SIZE * 0.75);
  ctx.lineTo(x + TILE_SIZE * 0.4, y + TILE_SIZE * 0.3);
  ctx.lineTo(x + TILE_SIZE * 0.6, y + TILE_SIZE * 0.3);
  ctx.lineTo(x + TILE_SIZE * 0.7, y + TILE_SIZE * 0.75);
  ctx.closePath();
  ctx.fill();
  
  // Contorno
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // Cruz simples
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + TILE_SIZE * 0.5, y + TILE_SIZE * 0.4);
  ctx.lineTo(x + TILE_SIZE * 0.5, y + TILE_SIZE * 0.65);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + TILE_SIZE * 0.42, y + TILE_SIZE * 0.5);
  ctx.lineTo(x + TILE_SIZE * 0.58, y + TILE_SIZE * 0.5);
  ctx.stroke();
}

/**
 * Desenha um tile de caminho
 */
function drawPath(ctx, x, y, seed) {
  ctx.fillStyle = '#8b7355';
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  
  // Texturas
  ctx.fillStyle = '#a0826d';
  for (let i = 0; i < 4; i++) {
    const px = x + (seed * i) % TILE_SIZE;
    const py = y + (seed * (i + 1)) % TILE_SIZE;
    ctx.fillRect(px, py, 3, 3);
  }
  
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
}

/**
 * Desenha um tile de cerca
 */
function drawFence(ctx, x, y, seed) {
  drawGrass(ctx, x, y, seed);
  
  // Postes
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(x + TILE_SIZE * 0.2, y + TILE_SIZE * 0.3, TILE_SIZE * 0.08, TILE_SIZE * 0.5);
  ctx.fillRect(x + TILE_SIZE * 0.72, y + TILE_SIZE * 0.3, TILE_SIZE * 0.08, TILE_SIZE * 0.5);
  
  // Travessas
  ctx.fillStyle = '#a0672f';
  ctx.fillRect(x + TILE_SIZE * 0.28, y + TILE_SIZE * 0.4, TILE_SIZE * 0.5, TILE_SIZE * 0.06);
  ctx.fillRect(x + TILE_SIZE * 0.28, y + TILE_SIZE * 0.58, TILE_SIZE * 0.5, TILE_SIZE * 0.06);
}

/**
 * Desenha um tile de pedra
 */
function drawStone(ctx, x, y, seed) {
  ctx.fillStyle = '#7a7a7a';
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  
  // Textura
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(x + TILE_SIZE * 0.1, y + TILE_SIZE * 0.1, TILE_SIZE * 0.8, TILE_SIZE * 0.15);
  ctx.fillRect(x + TILE_SIZE * 0.3, y + TILE_SIZE * 0.5, TILE_SIZE * 0.4, TILE_SIZE * 0.1);
  
  // Sombra
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.fillRect(x, y + TILE_SIZE - 2, TILE_SIZE, 2);
  
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
}

/**
 * Cria um tileset combinando vários tiles
 */
function createTileset(name, numberOfTiles, drawFunction) {
  const tilesPerRow = 8;
  const rows = Math.ceil(numberOfTiles / tilesPerRow);
  const width = tilesPerRow * TILE_SIZE;
  const height = rows * TILE_SIZE;
  
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Fundo branco para visualização
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  
  // Desenha cada tile
  for (let i = 0; i < numberOfTiles; i++) {
    const col = i % tilesPerRow;
    const row = Math.floor(i / tilesPerRow);
    const x = col * TILE_SIZE;
    const y = row * TILE_SIZE;
    drawFunction(ctx, x, y, i);
  }
  
  // Salva como PNG
  const buffer = canvas.toBuffer('image/png');
  const filepath = path.join(tilesetsDir, `${name}.png`);
  fs.writeFileSync(filepath, buffer);
  console.log(`✓ Tileset criado: ${name}.png (${TILE_SIZE}x${TILE_SIZE})`);
}

/**
 * Gera um tileset misto com múltiplos tipos de tiles
 */
function createMixedTileset(name, tileDefinitions) {
  const tilesPerRow = 8;
  const numberOfTiles = tileDefinitions.length;
  const rows = Math.ceil(numberOfTiles / tilesPerRow);
  const width = tilesPerRow * TILE_SIZE;
  const height = rows * TILE_SIZE;
  
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  
  for (let i = 0; i < numberOfTiles; i++) {
    const col = i % tilesPerRow;
    const row = Math.floor(i / tilesPerRow);
    const x = col * TILE_SIZE;
    const y = row * TILE_SIZE;
    const drawFunc = tileDefinitions[i];
    if (drawFunc) drawFunc(ctx, x, y, i);
  }
  
  const buffer = canvas.toBuffer('image/png');
  const filepath = path.join(tilesetsDir, `${name}.png`);
  fs.writeFileSync(filepath, buffer);
  console.log(`✓ Tileset misto criado: ${name}.png (${numberOfTiles} tiles)`);
}

// Gera tilesets
console.log('🎨 Gerando tilesets melhorados...\n');

// Tileset para E5 (Cidade)
createMixedTileset('e5-city', [
  (ctx, x, y, i) => drawGrass(ctx, x, y, i),
  (ctx, x, y, i) => drawDarkGrass(ctx, x, y, i),
  (ctx, x, y, i) => drawPath(ctx, x, y, i),
  (ctx, x, y, i) => drawStone(ctx, x, y, i),
  (ctx, x, y, i) => drawTree(ctx, x, y, i),
  (ctx, x, y, i) => drawGraveStone(ctx, x, y, i),
  (ctx, x, y, i) => drawGrass(ctx, x, y, i),
  (ctx, x, y, i) => drawGrass(ctx, x, y, i),
]);

// Tileset para E4 (Planícies)
createMixedTileset('e4-plain', [
  (ctx, x, y, i) => drawGrass(ctx, x, y, i),
  (ctx, x, y, i) => drawFlowers(ctx, x, y, i),
  (ctx, x, y, i) => drawWater(ctx, x, y, i),
  (ctx, x, y, i) => drawTree(ctx, x, y, i),
  (ctx, x, y, i) => drawPath(ctx, x, y, i),
  (ctx, x, y, i) => drawFence(ctx, x, y, i),
  (ctx, x, y, i) => drawDarkGrass(ctx, x, y, i),
  (ctx, x, y, i) => drawGrass(ctx, x, y, i),
]);

console.log('\n✨ Tilesets gerados com sucesso!');
console.log('Localização: public/assets/tilesets/');
