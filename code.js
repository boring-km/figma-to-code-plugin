// Figma Plugin: UI to HTML Exporter v2
// Exports selected nodes or the whole page as HTML with Compose-ready metadata.
// Features: Auto Layout→Flexbox, multi-fill, radial gradient, blur, SVG vectors,
// mixed text styles, image format/scale, CSS variables, progress tracking.

figma.showUI(__html__, { width: 760, height: 580 });

// ── Main handler ──

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'export-compose') {
    await handleExportCompose(msg);
    return;
  }

  if (msg.type !== 'export-html') return;

  const scope = msg.scope || 'selection';
  const options = normalizeOptions(msg.options);

  // Image collection
  const imageAssets = [];
  let imageCounter = 0;
  const imgExt = { PNG: '.png', JPG: '.jpg', JPEG: '.jpg', WEBP: '.webp' };
  function collectImage(base64) {
    imageCounter++;
    const ext = imgExt[options.imageFormat] || '.png';
    const name = 'images/img-' + String(imageCounter).padStart(3, '0') + ext;
    imageAssets.push({ name, base64 });
    return name;
  }

  let roots = [];
  if (scope === 'selection' && figma.currentPage.selection.length) {
    roots = figma.currentPage.selection;
  } else {
    roots = figma.currentPage.children;
  }

  // Progress tracking
  const totalNodes = roots.reduce((sum, r) => sum + countNodes(r), 0);
  let processedNodes = 0;
  function onProgress() {
    processedNodes++;
    if (processedNodes % 5 === 0 || processedNodes === totalNodes) {
      figma.ui.postMessage({ type: 'export-progress', current: processedNodes, total: totalNodes });
    }
  }

  const bounds = unionBounds(roots);
  const originX = bounds ? bounds.x : 0;
  const originY = bounds ? bounds.y : 0;

  figma.ui.postMessage({ type: 'export-progress', current: 0, total: totalNodes });

  const elements = [];
  let z = 1;
  for (const root of roots) {
    const html = await serializeTree(root, { x: originX, y: originY }, options, () => z++, collectImage, false, onProgress);
    if (html) elements.push(html);
  }

  const w = bounds ? Math.ceil(bounds.width) : 0;
  const h = bounds ? Math.ceil(bounds.height) : 0;

  const cssLines = [
    'html,body{margin:0;padding:0}',
    `.figma-export{position:relative;${w ? `width:${w}px;` : ''}${h ? `height:${h}px;` : ''}}`,
    '.figma-node{box-sizing:border-box}',
    '.figma-abs{position:absolute}',
    '.figma-text{white-space:pre-wrap;word-break:break-word}',
    '.figma-clip{overflow:hidden}',
    '.figma-img{display:block;width:100%;height:100%;object-fit:cover}'
  ];

  let wrapper = (
    '<!doctype html>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Exported HTML</title>' +
    `<style>\n${cssLines.join('\n')}\n</style>` +
    `<div class="figma-export">${elements.join('\n')}</div>`
  );

  // CSS variable extraction (post-processing)
  if (options.extractCssVars) {
    wrapper = extractCssVariables(wrapper);
  }

  // Custom filename from root node name
  const fileName = (roots.length === 1 && roots[0].name)
    ? sanitizeFileName(roots[0].name)
    : 'figma-export';

  figma.ui.postMessage({ type: 'html-result', html: wrapper, images: imageAssets, fileName });
  figma.ui.postMessage({ type: 'export-progress', current: totalNodes, total: totalNodes });
};

// ── Serialization ──

async function serializeTree(node, origin, options, nextZ, collectImage, parentIsAutoLayout, onProgress) {
  if (!node || node.visible === false) return null;
  if (onProgress) onProgress();

  // Text nodes require font loading
  if (node.type === 'TEXT') {
    try { await figma.loadFontAsync(node.fontName); } catch (e) {}
  }

  const box = getAbsBox(node);
  if (!box) return null;

  const left = Math.round(box.x - origin.x);
  const top = Math.round(box.y - origin.y);
  const width = Math.round(box.width);
  const height = Math.round(box.height);

  const z = nextZ ? nextZ() : 1;
  const isAutoLayout = node.layoutMode && node.layoutMode !== 'NONE';

  // Build class list
  let cls = 'figma-node';
  if (!parentIsAutoLayout) cls += ' figma-abs';

  // Build style
  let style = '';
  if (parentIsAutoLayout) {
    // Flex child: width/height only, no absolute position
    style = `width:${width}px;height:${height}px;`;
    // flex grow
    if (node.layoutGrow === 1) {
      const parentDir = node.parent && node.parent.layoutMode;
      if (parentDir === 'HORIZONTAL') style = style.replace(/width:\d+px;/, '') + 'flex:1;';
      else if (parentDir === 'VERTICAL') style = style.replace(/height:\d+px;/, '') + 'flex:1;';
    }
    // align-self
    if (node.layoutAlign === 'STRETCH') style += 'align-self:stretch;';
  } else {
    style = `left:${left}px;top:${top}px;width:${width}px;height:${height}px;z-index:${z};`;
  }

  if (typeof node.opacity === 'number' && node.opacity < 1) {
    style += `opacity:${node.opacity};`;
  }

  // data-figma-* attributes for Compose conversion
  let dataAttrs = ` data-figma-type="${node.type}"`;
  dataAttrs += ` data-figma-name="${escapeAttr(node.name || '')}"`;
  if (typeof node.opacity === 'number' && node.opacity < 1) {
    dataAttrs += ` data-figma-opacity="${node.opacity}"`;
  }
  if (node.fills && Array.isArray(node.fills)) {
    const visibleFills = node.fills.filter(f => f && f.visible !== false);
    if (visibleFills.length) {
      dataAttrs += ` data-figma-fills='${escapeAttr(JSON.stringify(visibleFills))}'`;
    }
  }
  if (node.effects && Array.isArray(node.effects)) {
    const visibleEffects = node.effects.filter(e => e && e.visible !== false);
    if (visibleEffects.length) {
      dataAttrs += ` data-figma-effects='${escapeAttr(JSON.stringify(visibleEffects))}'`;
    }
  }
  const radiusData = getRadiusData(node);
  if (radiusData) {
    dataAttrs += ` data-figma-radius='${escapeAttr(JSON.stringify(radiusData))}'`;
  }

  // ── TEXT node ──
  if (node.type === 'TEXT') {
    cls += ' figma-text';
    if (options.includeEffects) style += cssEffects(node);
    let textStyle = '';
    if (options.includeTextStyles) textStyle = cssText(node);

    // Mixed text styles
    let content;
    try {
      const segments = node.getStyledTextSegments([
        'fontName', 'fontSize', 'fontWeight', 'fills', 'lineHeight',
        'letterSpacing', 'textDecoration', 'textCase'
      ]);
      if (segments && segments.length > 1) {
        content = segments.map(seg => {
          const s = cssTextSegment(seg);
          return s
            ? `<span style="${escapeAttr(s)}">${escapeHtml(seg.characters)}</span>`
            : escapeHtml(seg.characters);
        }).join('');
      } else {
        content = escapeHtml(node.characters || '');
      }
    } catch (e) {
      content = escapeHtml(node.characters || '');
    }

    return `<div class="${cls}" style="${escapeAttr(style + textStyle)}"${dataAttrs}>${content}</div>`;
  }

  // ── SVG vector export ──
  if (options.exportVectorsSvg && isVectorNode(node)) {
    try {
      figma.ui.postMessage({ type: 'export-status', status: `SVG: ${node.name || node.type}` });
      const svgBytes = await node.exportAsync({ format: 'SVG' });
      const svgString = String.fromCharCode.apply(null, new Uint16Array(svgBytes));
      return `<div class="${cls}" style="${escapeAttr(style)}"${dataAttrs}>${svgString}</div>`;
    } catch (e) {
      // Fall through to rasterize
    }
  }

  // ── Rasterize instances/components ──
  if (options.rasterizeInstancesComponents && isRasterizeCandidate(node)) {
    try {
      figma.ui.postMessage({ type: 'export-status', status: `Rasterizing: ${node.name || node.type}` });
      const bytes = await node.exportAsync(buildExportSettings(options));
      const b64 = figma.base64Encode(bytes);
      const imgSrc = collectImage ? collectImage(b64) : `data:image/png;base64,${b64}`;
      return (
        `<div class="${cls}${node.clipsContent ? ' figma-clip' : ''}" style="${escapeAttr(style)}"${dataAttrs}>` +
        `<img class="figma-img" alt="" src="${imgSrc}">` +
        `</div>`
      );
    } catch (e) {}
  }

  // ── Rasterize clipped/masked containers ──
  if (options.rasterizeClippedMaskedContainers && isClippingContainer(node)) {
    try {
      figma.ui.postMessage({ type: 'export-status', status: `Rasterizing clipped: ${node.name || node.type}` });
      const bytes = await node.exportAsync(buildExportSettings(options));
      const b64 = figma.base64Encode(bytes);
      const imgSrc = collectImage ? collectImage(b64) : `data:image/png;base64,${b64}`;
      return (
        `<div class="${cls} figma-clip" style="${escapeAttr(style)}"${dataAttrs}>` +
        `<img class="figma-img" alt="" src="${imgSrc}">` +
        `</div>`
      );
    } catch (e) {}
  }

  // ── Visual styles ──
  if (options.includeFills) style += cssFills(node);
  if (options.includeStrokes) style += cssStrokes(node);
  if (options.includeRadius) {
    const r = cssRadius(node);
    if (r) { style += r; cls += ' figma-clip'; }
  }
  if (node.clipsContent) cls += ' figma-clip';
  if (options.includeEffects) style += cssEffects(node);

  // ── Auto Layout → Flexbox ──
  if (isAutoLayout) {
    const flexCss = cssAutoLayout(node);
    if (flexCss) {
      style += flexCss;
      const dir = node.layoutMode === 'HORIZONTAL' ? 'HORIZONTAL' : 'VERTICAL';
      dataAttrs += ` data-figma-layout="${dir}"`;
      dataAttrs += ` data-figma-spacing="${node.itemSpacing || 0}"`;
      dataAttrs += ` data-figma-padding="${node.paddingTop || 0},${node.paddingRight || 0},${node.paddingBottom || 0},${node.paddingLeft || 0}"`;
    }
  }

  // ── Image fills ──
  if (options.embedImages && hasImageFill(node)) {
    try {
      figma.ui.postMessage({ type: 'export-status', status: `Image: ${node.name || node.type}` });
      const bytes = await node.exportAsync(buildExportSettings(options));
      const b64 = figma.base64Encode(bytes);
      const imgSrc = collectImage ? collectImage(b64) : `data:image/png;base64,${b64}`;
      return (
        `<div class="${cls}" style="${escapeAttr(style)}"${dataAttrs}>` +
        `<img class="figma-img" alt="" src="${imgSrc}">` +
        `</div>`
      );
    } catch (e) {}
  }

  // ── Children ──
  const children = options.includeChildren ? getChildren(node) : [];
  if (!children.length) {
    return `<div class="${cls}" style="${escapeAttr(style)}"${dataAttrs}></div>`;
  }

  const childOrigin = isAutoLayout ? { x: box.x, y: box.y } : { x: box.x, y: box.y };
  const inner = await serializeChildren(node, children, box, options, nextZ, collectImage, isAutoLayout, onProgress);
  return `<div class="${cls}" style="${escapeAttr(style)}"${dataAttrs}>${inner.join('')}</div>`;
}

async function serializeChildren(parent, children, parentBox, options, nextZ, collectImage, parentIsAutoLayout, onProgress) {
  const out = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child) continue;

    // Mask handling
    if (child.isMask === true) {
      const maskBox = getAbsBox(child);
      if (!maskBox) continue;

      const masked = [];
      let j = i + 1;
      for (; j < children.length; j++) {
        const sib = children[j];
        if (sib && sib.isMask === true) break;
        masked.push(sib);
      }

      const z = nextZ ? nextZ() : 1;
      const left = Math.round(maskBox.x - parentBox.x);
      const top = Math.round(maskBox.y - parentBox.y);
      const width = Math.round(maskBox.width);
      const height = Math.round(maskBox.height);

      let maskStyle = `left:${left}px;top:${top}px;width:${width}px;height:${height}px;z-index:${z};`;
      let maskCls = 'figma-node figma-abs figma-clip';

      if (options.includeRadius) {
        if (child.type === 'ELLIPSE') maskStyle += 'border-radius:9999px;';
        else { const r = cssRadius(child); if (r) maskStyle += r; }
      }

      const inner = [];
      for (const m of masked) {
        const html = await serializeTree(m, { x: maskBox.x, y: maskBox.y }, options, nextZ, collectImage, false, onProgress);
        if (html) inner.push(html);
      }

      out.push(`<div class="${maskCls}" style="${escapeAttr(maskStyle)}" data-figma-type="MASK">${inner.join('')}</div>`);
      i = j - 1;
      continue;
    }

    const html = await serializeTree(child, { x: parentBox.x, y: parentBox.y }, options, nextZ, collectImage, parentIsAutoLayout, onProgress);
    if (html) out.push(html);
  }
  return out;
}

// ── Auto Layout → Flexbox ──

function cssAutoLayout(node) {
  if (!node || !node.layoutMode || node.layoutMode === 'NONE') return null;
  const dir = node.layoutMode === 'HORIZONTAL' ? 'row' : 'column';
  const gap = node.itemSpacing || 0;
  const pt = node.paddingTop || 0;
  const pr = node.paddingRight || 0;
  const pb = node.paddingBottom || 0;
  const pl = node.paddingLeft || 0;

  const justifyMap = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' };
  const alignMap = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', BASELINE: 'baseline' };

  let css = `display:flex;flex-direction:${dir};gap:${gap}px;`;
  css += `padding:${pt}px ${pr}px ${pb}px ${pl}px;`;

  const jc = justifyMap[node.primaryAxisAlignItems];
  if (jc) css += `justify-content:${jc};`;
  const ai = alignMap[node.counterAxisAlignItems];
  if (ai) css += `align-items:${ai};`;

  if (node.layoutWrap === 'WRAP') css += 'flex-wrap:wrap;';
  if (node.primaryAxisSizingMode === 'AUTO') css += dir === 'row' ? 'width:fit-content;' : 'height:fit-content;';
  if (node.counterAxisSizingMode === 'AUTO') css += dir === 'row' ? 'height:fit-content;' : 'width:fit-content;';

  return css;
}

// ── CSS helpers ──

function cssFills(node) {
  if (!node || !node.fills || !Array.isArray(node.fills)) return '';
  const fills = node.fills.filter(f => f && f.visible !== false);
  if (!fills.length) return '';

  // Multiple fills: Figma renders last on top; CSS first background is on top
  const layers = [];
  for (let i = fills.length - 1; i >= 0; i--) {
    const f = fills[i];
    if (f.type === 'SOLID') {
      layers.push(colorToCss(f.color, f.opacity));
    } else if (f.type === 'GRADIENT_LINEAR') {
      const g = gradientLinearToCss(f);
      if (g) layers.push(g);
    } else if (f.type === 'GRADIENT_RADIAL') {
      const g = gradientRadialToCss(f);
      if (g) layers.push(g);
    }
  }
  return layers.length ? `background:${layers.join(',')};` : '';
}

function cssStrokes(node) {
  if (!node || !node.strokes || !Array.isArray(node.strokes)) return '';
  const strokes = node.strokes.filter(s => s && s.visible !== false);
  if (!strokes.length) return '';

  const s = strokes[0];
  if (s.type !== 'SOLID') return '';
  const weight = typeof node.strokeWeight === 'number' ? node.strokeWeight : 1;
  const align = node.strokeAlign || 'INSIDE';

  if (align === 'CENTER' || align === 'OUTSIDE') {
    return `outline:${weight}px solid ${colorToCss(s.color, s.opacity)};outline-offset:0;`;
  }
  return `border:${weight}px solid ${colorToCss(s.color, s.opacity)};`;
}

function cssRadius(node) {
  if (!node) return '';
  const hasTL = typeof node.topLeftRadius === 'number';
  const hasTR = typeof node.topRightRadius === 'number';
  const hasBR = typeof node.bottomRightRadius === 'number';
  const hasBL = typeof node.bottomLeftRadius === 'number';
  if (hasTL && hasTR && hasBR && hasBL) {
    const tl = node.topLeftRadius || 0;
    const tr = node.topRightRadius || 0;
    const br = node.bottomRightRadius || 0;
    const bl = node.bottomLeftRadius || 0;
    if (tl === 0 && tr === 0 && br === 0 && bl === 0) return '';
    return `border-radius:${tl}px ${tr}px ${br}px ${bl}px;`;
  }
  if (typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
    return `border-radius:${node.cornerRadius}px;`;
  }
  return '';
}

function getRadiusData(node) {
  if (!node) return null;
  if (typeof node.topLeftRadius === 'number') {
    const tl = node.topLeftRadius || 0;
    const tr = node.topRightRadius || 0;
    const br = node.bottomRightRadius || 0;
    const bl = node.bottomLeftRadius || 0;
    if (tl || tr || br || bl) return { tl, tr, br, bl };
  }
  if (typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
    return { tl: node.cornerRadius, tr: node.cornerRadius, br: node.cornerRadius, bl: node.cornerRadius };
  }
  return null;
}

function cssEffects(node) {
  if (!node || !node.effects || !Array.isArray(node.effects)) return '';
  const shadows = [];
  const filters = [];
  const backdropFilters = [];

  for (const e of node.effects) {
    if (!e || e.visible === false) continue;
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      const c = colorToCss(e.color, e.color && typeof e.color.a === 'number' ? e.color.a : 1);
      const inset = e.type === 'INNER_SHADOW' ? 'inset ' : '';
      const x = e.offset ? e.offset.x : 0;
      const y = e.offset ? e.offset.y : 0;
      const blur = typeof e.radius === 'number' ? e.radius : 0;
      const spread = typeof e.spread === 'number' ? e.spread : 0;
      shadows.push(`${inset}${x}px ${y}px ${blur}px ${spread}px ${c}`);
    }
    if (e.type === 'LAYER_BLUR') {
      filters.push(`blur(${typeof e.radius === 'number' ? e.radius : 0}px)`);
    }
    if (e.type === 'BACKGROUND_BLUR') {
      backdropFilters.push(`blur(${typeof e.radius === 'number' ? e.radius : 0}px)`);
    }
  }

  let css = '';
  if (shadows.length) css += `box-shadow:${shadows.join(',')};`;
  if (filters.length) css += `filter:${filters.join(' ')};`;
  if (backdropFilters.length) css += `backdrop-filter:${backdropFilters.join(' ')};`;
  return css;
}

function cssText(node) {
  if (!node) return '';
  const parts = [];

  try {
    if (node.fills && Array.isArray(node.fills)) {
      const solid = node.fills.find(f => f && f.visible !== false && f.type === 'SOLID');
      if (solid) parts.push(`color:${colorToCss(solid.color, solid.opacity)};`);
    }
  } catch (e) {}

  try {
    if (node.fontSize && node.fontSize !== figma.mixed) parts.push(`font-size:${node.fontSize}px;`);
  } catch (e) {}

  try {
    if (node.fontName && node.fontName !== figma.mixed) {
      const fam = node.fontName.family;
      const sty = node.fontName.style;
      if (fam) parts.push(`font-family:${quoteFontFamily(fam)};`);
      if (sty && /italic/i.test(sty)) parts.push('font-style:italic;');
      const w = fontWeightFromStyle(sty);
      if (w) parts.push(`font-weight:${w};`);
    }
  } catch (e) {}

  try {
    if (node.lineHeight && node.lineHeight !== figma.mixed) {
      if (node.lineHeight.unit === 'PIXELS') parts.push(`line-height:${node.lineHeight.value}px;`);
      if (node.lineHeight.unit === 'PERCENT') parts.push(`line-height:${node.lineHeight.value}%;`);
    }
  } catch (e) {}

  try {
    if (node.letterSpacing && node.letterSpacing !== figma.mixed) {
      if (node.letterSpacing.unit === 'PIXELS') parts.push(`letter-spacing:${node.letterSpacing.value}px;`);
      if (node.letterSpacing.unit === 'PERCENT') parts.push(`letter-spacing:${node.letterSpacing.value}%;`);
    }
  } catch (e) {}

  try {
    if (node.textAlignHorizontal) {
      const m = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' };
      if (m[node.textAlignHorizontal]) parts.push(`text-align:${m[node.textAlignHorizontal]};`);
    }
  } catch (e) {}

  try {
    if (node.textDecoration) {
      const m = { UNDERLINE: 'underline', STRIKETHROUGH: 'line-through', NONE: 'none' };
      if (m[node.textDecoration]) parts.push(`text-decoration:${m[node.textDecoration]};`);
    }
  } catch (e) {}

  try {
    if (node.textCase) {
      const m = { UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize', ORIGINAL: '' };
      if (m[node.textCase]) parts.push(`text-transform:${m[node.textCase]};`);
    }
  } catch (e) {}

  return parts.join('');
}

function cssTextSegment(seg) {
  if (!seg) return '';
  const parts = [];

  if (seg.fills && Array.isArray(seg.fills)) {
    const solid = seg.fills.find(f => f && f.visible !== false && f.type === 'SOLID');
    if (solid) parts.push(`color:${colorToCss(solid.color, solid.opacity)};`);
  }
  if (seg.fontSize) parts.push(`font-size:${seg.fontSize}px;`);
  if (seg.fontName) {
    const fam = seg.fontName.family;
    const sty = seg.fontName.style;
    if (fam) parts.push(`font-family:${quoteFontFamily(fam)};`);
    if (sty && /italic/i.test(sty)) parts.push('font-style:italic;');
    const w = fontWeightFromStyle(sty);
    if (w) parts.push(`font-weight:${w};`);
  }
  if (seg.lineHeight) {
    if (seg.lineHeight.unit === 'PIXELS') parts.push(`line-height:${seg.lineHeight.value}px;`);
    if (seg.lineHeight.unit === 'PERCENT') parts.push(`line-height:${seg.lineHeight.value}%;`);
  }
  if (seg.letterSpacing) {
    if (seg.letterSpacing.unit === 'PIXELS') parts.push(`letter-spacing:${seg.letterSpacing.value}px;`);
    if (seg.letterSpacing.unit === 'PERCENT') parts.push(`letter-spacing:${seg.letterSpacing.value}%;`);
  }
  if (seg.textDecoration) {
    const m = { UNDERLINE: 'underline', STRIKETHROUGH: 'line-through' };
    if (m[seg.textDecoration]) parts.push(`text-decoration:${m[seg.textDecoration]};`);
  }
  if (seg.textCase) {
    const m = { UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize' };
    if (m[seg.textCase]) parts.push(`text-transform:${m[seg.textCase]};`);
  }

  return parts.join('');
}

// ── Gradient helpers ──

function gradientLinearToCss(fill) {
  if (!fill || !fill.gradientStops || !fill.gradientStops.length) return null;
  const stops = fill.gradientStops
    .map(s => {
      const c = colorToCss(s.color, s.color && typeof s.color.a === 'number' ? s.color.a : 1);
      const p = typeof s.position === 'number' ? Math.round(s.position * 100) : null;
      return p === null ? c : `${c} ${p}%`;
    })
    .join(', ');

  let angle = 180;
  try {
    const gt = fill.gradientTransform;
    if (gt && gt.length === 2) {
      const a = gt[0][0], b = gt[1][0];
      if (typeof a === 'number' && typeof b === 'number') {
        angle = (Math.atan2(b, a) * 180) / Math.PI;
        angle = (angle + 360) % 360;
      }
    }
  } catch (e) {}

  return `linear-gradient(${Math.round(angle)}deg, ${stops})`;
}

function gradientRadialToCss(fill) {
  if (!fill || !fill.gradientStops || !fill.gradientStops.length) return null;
  const stops = fill.gradientStops
    .map(s => {
      const c = colorToCss(s.color, s.color && typeof s.color.a === 'number' ? s.color.a : 1);
      const p = typeof s.position === 'number' ? Math.round(s.position * 100) : null;
      return p === null ? c : `${c} ${p}%`;
    })
    .join(', ');

  // Extract center from gradientTransform (2x3 matrix)
  let cx = 50, cy = 50;
  try {
    const gt = fill.gradientTransform;
    if (gt && gt.length === 2) {
      cx = Math.round((gt[0][2] || 0.5) * 100);
      cy = Math.round((gt[1][2] || 0.5) * 100);
    }
  } catch (e) {}

  return `radial-gradient(ellipse at ${cx}% ${cy}%, ${stops})`;
}

// ── Node type helpers ──

function isVectorNode(node) {
  if (!node) return false;
  const t = node.type;
  return t === 'VECTOR' || t === 'STAR' || t === 'LINE' || t === 'ELLIPSE' || t === 'POLYGON' || t === 'BOOLEAN_OPERATION';
}

function isRasterizeCandidate(node) {
  if (!node) return false;
  const t = node.type;
  return t === 'INSTANCE' || t === 'COMPONENT' || t === 'COMPONENT_SET';
}

function isClippingContainer(node) {
  if (!node) return false;
  if (node.clipsContent === true) return true;
  if (node.isMask === true) return true;
  return false;
}

function hasImageFill(node) {
  if (!node || !node.fills || !Array.isArray(node.fills)) return false;
  return node.fills.some(f => f && f.visible !== false && f.type === 'IMAGE');
}

// ── Utilities ──

function buildExportSettings(options) {
  const fmt = options.imageFormat || 'PNG';
  const settings = { format: fmt };
  if (options.imageScale && options.imageScale > 1) {
    settings.constraint = { type: 'SCALE', value: options.imageScale };
  }
  return settings;
}

function normalizeOptions(input) {
  const o = input || {};
  return {
    includeChildren: o.includeChildren !== false,
    includeFills: o.includeFills !== false,
    includeStrokes: o.includeStrokes !== false,
    includeRadius: o.includeRadius !== false,
    includeEffects: o.includeEffects !== false,
    includeTextStyles: o.includeTextStyles !== false,
    embedImages: o.embedImages !== false,
    rasterizeInstancesComponents: o.rasterizeInstancesComponents === true,
    rasterizeClippedMaskedContainers: o.rasterizeClippedMaskedContainers !== false,
    exportVectorsSvg: o.exportVectorsSvg !== false,
    imageFormat: o.imageFormat || 'PNG',
    imageScale: o.imageScale || 1,
    extractCssVars: o.extractCssVars === true
  };
}

function countNodes(node) {
  let count = 1;
  if (node.children) {
    for (const c of node.children) count += countNodes(c);
  }
  return count;
}

function getAbsBox(node) {
  const box = node.absoluteBoundingBox;
  if (box) return box;
  try {
    const t = node.absoluteTransform;
    const tx = t[0][2], ty = t[1][2];
    const w = node.width || 0, h = node.height || 0;
    if (typeof tx === 'number' && typeof ty === 'number') return { x: tx, y: ty, width: w, height: h };
  } catch (e) {}
  return null;
}

function getChildren(node) {
  if (!node || !node.children) return [];
  return node.children;
}

function unionBounds(nodes) {
  const boxes = [];
  for (const n of nodes || []) {
    const b = getAbsBox(n);
    if (b) boxes.push(b);
  }
  if (!boxes.length) return null;
  let minX = boxes[0].x, minY = boxes[0].y;
  let maxX = boxes[0].x + boxes[0].width, maxY = boxes[0].y + boxes[0].height;
  for (const b of boxes.slice(1)) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function colorToCss(color, opacity) {
  if (!color) return 'transparent';
  const r = Math.round((color.r || 0) * 255);
  const g = Math.round((color.g || 0) * 255);
  const b = Math.round((color.b || 0) * 255);
  const a = (typeof opacity === 'number') ? opacity : (typeof color.a === 'number' ? color.a : 1);
  return `rgba(${r},${g},${b},${a})`;
}

function quoteFontFamily(fam) {
  if (!fam) return 'sans-serif';
  if (/^[a-zA-Z0-9_-]+$/.test(fam)) return fam;
  return `"${String(fam).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function fontWeightFromStyle(style) {
  if (!style) return null;
  const s = String(style).toLowerCase();
  if (s.includes('thin')) return 100;
  if (s.includes('extra light') || s.includes('extralight') || s.includes('ultra light') || s.includes('ultralight')) return 200;
  if (s.includes('light')) return 300;
  if (s.includes('regular') || s.includes('normal')) return 400;
  if (s.includes('medium')) return 500;
  if (s.includes('semi bold') || s.includes('semibold') || s.includes('demi bold') || s.includes('demibold')) return 600;
  if (s.includes('bold')) return 700;
  if (s.includes('extra bold') || s.includes('extrabold') || s.includes('heavy')) return 800;
  if (s.includes('black')) return 900;
  return null;
}

function sanitizeFileName(name) {
  return String(name).replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '-').substring(0, 80) || 'figma-export';
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ── CSS Variable Extraction (post-processing) ──

function extractCssVariables(html) {
  // Collect rgba(...) colors from style="" attributes only
  const styleRegex = /style="([^"]*)"/g;
  const colorCount = {};
  let m;

  while ((m = styleRegex.exec(html)) !== null) {
    const styleVal = m[1];
    const colors = styleVal.match(/rgba\(\d+,\d+,\d+,[\d.]+\)/g);
    if (colors) {
      for (const c of colors) {
        colorCount[c] = (colorCount[c] || 0) + 1;
      }
    }
  }

  // Only extract colors used 2+ times
  const vars = {};
  let varIdx = 1;
  for (const [color, count] of Object.entries(colorCount)) {
    if (count >= 2) {
      vars[color] = `--color-${varIdx++}`;
    }
  }

  if (!Object.keys(vars).length) return html;

  // Build :root block
  const rootEntries = Object.entries(vars).map(([color, varName]) => `  ${varName}:${color};`).join('\n');
  const rootBlock = `:root{\n${rootEntries}\n}`;

  // Replace colors in style attributes only (not in data-figma-* attributes)
  let result = html;
  for (const [color, varName] of Object.entries(vars)) {
    // Replace only within style="..." - use a function replacer
    result = result.replace(/style="([^"]*)"/g, (match, styleVal) => {
      const replaced = styleVal.split(color).join(`var(${varName})`);
      return `style="${replaced}"`;
    });
  }

  // Inject :root block into <style>
  result = result.replace('<style>', `<style>\n${rootBlock}`);
  return result;
}

// ══════════════════════════════════════════════════════════════
// ══  Compose Export Engine                                  ══
// ══════════════════════════════════════════════════════════════

async function handleExportCompose(msg) {
  const scope = msg.scope || 'selection';
  const options = normalizeOptions(msg.options);
  const composeFormat = msg.composeFormat || 'single'; // 'single' | 'files'

  const imageAssets = [];
  let imageCounter = 0;
  const imgExt = { PNG: '.png', JPG: '.jpg', JPEG: '.jpg', WEBP: '.webp' };
  function collectImage(base64) {
    imageCounter++;
    const ext = imgExt[options.imageFormat] || '.png';
    const name = 'img_' + String(imageCounter).padStart(3, '0');
    imageAssets.push({ name: 'res/drawable/' + name + ext, base64, resName: name });
    return name;
  }

  let roots = [];
  if (scope === 'selection' && figma.currentPage.selection.length) {
    roots = figma.currentPage.selection;
  } else {
    roots = figma.currentPage.children;
  }

  const totalNodes = roots.reduce((sum, r) => sum + countNodes(r), 0);
  let processedNodes = 0;
  function onProgress() {
    processedNodes++;
    if (processedNodes % 5 === 0 || processedNodes === totalNodes) {
      figma.ui.postMessage({ type: 'export-progress', current: processedNodes, total: totalNodes });
    }
  }

  figma.ui.postMessage({ type: 'export-progress', current: 0, total: totalNodes });

  const components = new Map(); // name → kotlin code
  const colorSet = new Map(); // rgba string → variable name
  let colorIdx = 0;

  const bodyParts = [];
  for (const root of roots) {
    const code = await serializeCompose(root, 1, options, components, collectImage, false, onProgress, colorSet, () => colorIdx++);
    if (code) bodyParts.push(code);
  }

  const screenName = roots.length === 1 ? composeFunName(roots[0].name || 'Screen') : 'ExportedScreen';
  const fileName = (roots.length === 1 && roots[0].name) ? sanitizeFileName(roots[0].name) : 'figma-export';

  if (composeFormat === 'files') {
    const files = buildComposeFileStructure(screenName, bodyParts.join('\n'), components, colorSet, imageAssets);
    figma.ui.postMessage({ type: 'compose-result', code: files.mainCode, files, images: imageAssets, fileName, format: 'files' });
  } else {
    const code = buildComposeSingleOutput(screenName, bodyParts.join('\n'), components, colorSet);
    figma.ui.postMessage({ type: 'compose-result', code, images: imageAssets, fileName, format: 'single' });
  }

  figma.ui.postMessage({ type: 'export-progress', current: totalNodes, total: totalNodes });
}

// ── Main Compose serializer ──

async function serializeCompose(node, indent, options, components, collectImage, parentIsAL, onProgress, colorSet, nextColorIdx) {
  if (!node || node.visible === false) return null;
  if (onProgress) onProgress();

  if (node.type === 'TEXT') {
    try { await figma.loadFontAsync(node.fontName); } catch (e) {}
  }

  const box = getAbsBox(node);
  if (!box) return null;
  const pad = '    '.repeat(indent);
  const width = Math.round(box.width);
  const height = Math.round(box.height);

  // Component/Instance extraction
  if ((node.type === 'COMPONENT' || node.type === 'INSTANCE') && node.name) {
    const funName = composeFunName(node.name);
    if (!components.has(funName)) {
      const inner = await serializeComposeInner(node, 1, options, components, collectImage, false, onProgress, colorSet, nextColorIdx);
      components.set(funName, inner || '    // empty');
    }
    return `${pad}${funName}()`;
  }

  return await serializeComposeInner(node, indent, options, components, collectImage, parentIsAL, onProgress, colorSet, nextColorIdx);
}

async function serializeComposeInner(node, indent, options, components, collectImage, parentIsAL, onProgress, colorSet, nextColorIdx) {
  const box = getAbsBox(node);
  if (!box) return null;
  const pad = '    '.repeat(indent);
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  const isAL = node.layoutMode && node.layoutMode !== 'NONE';

  // TEXT node
  if (node.type === 'TEXT') {
    return composeText(node, indent, options, colorSet, nextColorIdx);
  }

  // Image fill
  if (options.embedImages && hasImageFill(node)) {
    try {
      figma.ui.postMessage({ type: 'export-status', status: `Image: ${node.name || node.type}` });
      const bytes = await node.exportAsync(buildExportSettings(options));
      const b64 = figma.base64Encode(bytes);
      const resName = collectImage(b64);
      const imgFill = node.fills.find(f => f && f.visible !== false && f.type === 'IMAGE');
      const scaleMode = imgFill && imgFill.scaleMode ? imgFill.scaleMode : 'FILL';
      return composeImage(resName, node.name, width, height, indent, scaleMode);
    } catch (e) {}
  }

  // SVG vector
  if (options.exportVectorsSvg && isVectorNode(node)) {
    try {
      const bytes = await node.exportAsync(buildExportSettings(options));
      const b64 = figma.base64Encode(bytes);
      const resName = collectImage(b64);
      return composeImage(resName, node.name, width, height, indent);
    } catch (e) {}
  }

  // Rasterize instances
  if (options.rasterizeInstancesComponents && isRasterizeCandidate(node)) {
    try {
      const bytes = await node.exportAsync(buildExportSettings(options));
      const b64 = figma.base64Encode(bytes);
      const resName = collectImage(b64);
      return composeImage(resName, node.name, width, height, indent);
    } catch (e) {}
  }

  // Rasterize clipped
  if (options.rasterizeClippedMaskedContainers && isClippingContainer(node)) {
    try {
      const bytes = await node.exportAsync(buildExportSettings(options));
      const b64 = figma.base64Encode(bytes);
      const resName = collectImage(b64);
      return composeImage(resName, node.name, width, height, indent);
    } catch (e) {}
  }

  // Build modifier chain
  const mods = composeModifiers(node, parentIsAL, options, width, height, colorSet, nextColorIdx);
  const children = options.includeChildren ? getChildren(node) : [];

  // Determine layout composable
  if (isAL) {
    const layoutInfo = composeAutoLayout(node, indent, mods, colorSet, nextColorIdx);
    if (!children.length) {
      return `${pad}${layoutInfo.open} {}`;
    }
    const inner = [];
    for (const child of children) {
      if (!child || child.visible === false) continue;
      const c = await serializeCompose(child, indent + 1, options, components, collectImage, true, onProgress, colorSet, nextColorIdx);
      if (c) inner.push(c);
    }
    const comment = node.name ? `${pad}// ${node.name}` : '';
    return (comment ? comment + '\n' : '') +
      `${pad}${layoutInfo.open} {\n${inner.join('\n')}\n${pad}}`;
  }

  // Box (no auto layout)
  if (!children.length) {
    const comment = node.name ? ` // ${node.name}` : '';
    return `${pad}Box(modifier = ${mods || 'Modifier'})${comment}`;
  }

  const inner = [];
  for (const child of children) {
    if (!child || child.visible === false) continue;
    const c = await serializeCompose(child, indent + 1, options, components, collectImage, false, onProgress, colorSet, nextColorIdx);
    if (c) inner.push(c);
  }
  const comment = node.name ? `${pad}// ${node.name}` : '';
  return (comment ? comment + '\n' : '') +
    `${pad}Box(modifier = ${mods || 'Modifier'}) {\n${inner.join('\n')}\n${pad}}`;
}

// ── Compose helpers ──

function composeModifiers(node, parentIsAL, options, w, h, colorSet, nextColorIdx) {
  const parts = [];

  // Size
  if (node.layoutGrow === 1 && parentIsAL) {
    const parentDir = node.parent && node.parent.layoutMode;
    if (parentDir === 'HORIZONTAL') {
      parts.push(`.weight(1f).height(${h}.dp)`);
    } else if (parentDir === 'VERTICAL') {
      parts.push(`.width(${w}.dp).weight(1f)`);
    } else {
      parts.push(`.size(width = ${w}.dp, height = ${h}.dp)`);
    }
  } else if (node.layoutAlign === 'STRETCH' && parentIsAL) {
    const parentDir = node.parent && node.parent.layoutMode;
    if (parentDir === 'HORIZONTAL') {
      parts.push(`.width(${w}.dp).fillMaxHeight()`);
    } else {
      parts.push(`.fillMaxWidth().height(${h}.dp)`);
    }
  } else {
    parts.push(`.size(width = ${w}.dp, height = ${h}.dp)`);
  }

  // Offset for absolute positioning
  if (!parentIsAL && node.parent) {
    const parentBox = getAbsBox(node.parent);
    const box = getAbsBox(node);
    if (parentBox && box) {
      const ox = Math.round(box.x - parentBox.x);
      const oy = Math.round(box.y - parentBox.y);
      if (ox !== 0 || oy !== 0) {
        parts.push(`.offset(x = ${ox}.dp, y = ${oy}.dp)`);
      }
    }
  }

  // Background
  if (options.includeFills) {
    const bg = composeFills(node, colorSet, nextColorIdx);
    if (bg) parts.push(bg);
  }

  // Border radius + clip
  if (options.includeRadius) {
    const shape = composeRadius(node);
    if (shape) parts.push(`.clip(${shape})`);
  }

  // Border
  if (options.includeStrokes) {
    const border = composeStrokes(node, colorSet, nextColorIdx);
    if (border) parts.push(border);
  }

  // Effects (shadow)
  if (options.includeEffects) {
    const fx = composeEffects(node);
    if (fx) parts.push(fx);
  }

  // Opacity
  if (typeof node.opacity === 'number' && node.opacity < 1) {
    parts.push(`.alpha(${numF(node.opacity)}f)`);
  }

  // Clip content
  if (node.clipsContent && options.includeRadius) {
    const shape = composeRadius(node);
    if (shape && !parts.some(p => p.includes('.clip('))) {
      parts.push(`.clip(${shape})`);
    }
  }

  if (!parts.length) return 'Modifier';
  return 'Modifier\n' + parts.map(p => '            ' + p).join('\n');
}

function composeAutoLayout(node, indent, modStr, colorSet, nextColorIdx) {
  const pad = '    '.repeat(indent);
  const isH = node.layoutMode === 'HORIZONTAL';
  const gap = node.itemSpacing || 0;
  const pt = node.paddingTop || 0;
  const pr = node.paddingRight || 0;
  const pb = node.paddingBottom || 0;
  const pl = node.paddingLeft || 0;

  // Padding modifier
  let padMod = '';
  if (pt === pb && pl === pr && pt === pl && pt > 0) {
    padMod = `.padding(${pt}.dp)`;
  } else if (pt === pb && pl === pr) {
    const parts = [];
    if (pt > 0) parts.push(`vertical = ${pt}.dp`);
    if (pl > 0) parts.push(`horizontal = ${pl}.dp`);
    if (parts.length) padMod = `.padding(${parts.join(', ')})`;
  } else {
    const parts = [];
    if (pt > 0) parts.push(`top = ${pt}.dp`);
    if (pr > 0) parts.push(`end = ${pr}.dp`);
    if (pb > 0) parts.push(`bottom = ${pb}.dp`);
    if (pl > 0) parts.push(`start = ${pl}.dp`);
    if (parts.length) padMod = `.padding(${parts.join(', ')})`;
  }

  const fullMod = modStr + (padMod ? '\n            ' + padMod : '');

  // Arrangement
  const arrangement = gap > 0
    ? `Arrangement.spacedBy(${gap}.dp)`
    : composeArrangement(node, isH);

  // Alignment
  const alignment = composeAlignment(node, isH);

  const composable = isH ? 'Row' : 'Column';
  const arrangeProp = isH ? 'horizontalArrangement' : 'verticalArrangement';
  const alignProp = isH ? 'verticalAlignment' : 'horizontalAlignment';

  let params = `modifier = ${fullMod}`;
  if (arrangement) params += `,\n${pad}    ${arrangeProp} = ${arrangement}`;
  if (alignment) params += `,\n${pad}    ${alignProp} = ${alignment}`;

  return {
    open: `${composable}(\n${pad}    ${params}\n${pad})`
  };
}

function composeArrangement(node, isH) {
  const primary = node.primaryAxisAlignItems;
  if (!primary) return null;
  const map = {
    MIN: isH ? 'Arrangement.Start' : 'Arrangement.Top',
    CENTER: 'Arrangement.Center',
    MAX: isH ? 'Arrangement.End' : 'Arrangement.Bottom',
    SPACE_BETWEEN: 'Arrangement.SpaceBetween'
  };
  return map[primary] || null;
}

function composeAlignment(node, isH) {
  const counter = node.counterAxisAlignItems;
  if (!counter) return null;
  if (isH) {
    const map = { MIN: 'Alignment.Top', CENTER: 'Alignment.CenterVertically', MAX: 'Alignment.Bottom' };
    return map[counter] || null;
  } else {
    const map = { MIN: 'Alignment.Start', CENTER: 'Alignment.CenterHorizontally', MAX: 'Alignment.End' };
    return map[counter] || null;
  }
}

function composeFills(node, colorSet, nextColorIdx) {
  if (!node || !node.fills || !Array.isArray(node.fills)) return null;
  const fills = node.fills.filter(f => f && f.visible !== false);
  if (!fills.length) return null;

  const f = fills[0]; // primary fill
  if (f.type === 'SOLID') {
    const c = composeColor(f.color, f.opacity);
    const shape = composeRadius(node);
    if (shape) return `.background(${c}, ${shape})`;
    return `.background(${c})`;
  }
  if (f.type === 'GRADIENT_LINEAR') {
    const brush = composeLinearGradient(f);
    if (brush) {
      const shape = composeRadius(node);
      if (shape) return `.background(brush = ${brush}, shape = ${shape})`;
      return `.background(brush = ${brush})`;
    }
  }
  if (f.type === 'GRADIENT_RADIAL') {
    const brush = composeRadialGradient(f);
    if (brush) return `.background(brush = ${brush})`;
  }
  return null;
}

function composeLinearGradient(fill) {
  if (!fill.gradientStops || !fill.gradientStops.length) return null;
  const colors = fill.gradientStops.map(s => composeColor(s.color, s.color && typeof s.color.a === 'number' ? s.color.a : 1));

  let angle = 180;
  try {
    const gt = fill.gradientTransform;
    if (gt && gt.length === 2) {
      angle = (Math.atan2(gt[1][0], gt[0][0]) * 180) / Math.PI;
      angle = (angle + 360) % 360;
    }
  } catch (e) {}

  // Map angle to start/end offsets
  let start, end;
  const roundAngle = Math.round(angle);
  if (roundAngle === 0 || roundAngle === 360) { start = 'Offset(Float.POSITIVE_INFINITY, 0f)'; end = 'Offset(0f, 0f)'; }
  else if (roundAngle === 90) { start = 'Offset(0f, 0f)'; end = 'Offset(Float.POSITIVE_INFINITY, 0f)'; }
  else if (roundAngle === 180) { start = 'Offset(0f, 0f)'; end = 'Offset(0f, Float.POSITIVE_INFINITY)'; }
  else if (roundAngle === 270) { start = 'Offset(Float.POSITIVE_INFINITY, 0f)'; end = 'Offset(0f, 0f)'; }
  else { start = 'Offset.Zero'; end = 'Offset.Infinite'; }

  return `Brush.linearGradient(\n                colors = listOf(${colors.join(', ')}),\n                start = ${start},\n                end = ${end}\n            )`;
}

function composeRadialGradient(fill) {
  if (!fill.gradientStops || !fill.gradientStops.length) return null;
  const colors = fill.gradientStops.map(s => composeColor(s.color, s.color && typeof s.color.a === 'number' ? s.color.a : 1));
  return `Brush.radialGradient(\n                colors = listOf(${colors.join(', ')})\n            )`;
}

function composeStrokes(node, colorSet, nextColorIdx) {
  if (!node || !node.strokes || !Array.isArray(node.strokes)) return null;
  const strokes = node.strokes.filter(s => s && s.visible !== false);
  if (!strokes.length) return null;

  const s = strokes[0];
  if (s.type !== 'SOLID') return null;
  const weight = typeof node.strokeWeight === 'number' ? node.strokeWeight : 1;
  const c = composeColor(s.color, s.opacity);
  const shape = composeRadius(node);
  if (shape) return `.border(width = ${weight}.dp, color = ${c}, shape = ${shape})`;
  return `.border(width = ${weight}.dp, color = ${c})`;
}

function composeRadius(node) {
  if (!node) return null;
  const hasTL = typeof node.topLeftRadius === 'number';
  if (hasTL) {
    const tl = node.topLeftRadius || 0;
    const tr = node.topRightRadius || 0;
    const br = node.bottomRightRadius || 0;
    const bl = node.bottomLeftRadius || 0;
    if (tl === 0 && tr === 0 && br === 0 && bl === 0) return null;
    if (tl === tr && tr === br && br === bl) return `RoundedCornerShape(${tl}.dp)`;
    return `RoundedCornerShape(topStart = ${tl}.dp, topEnd = ${tr}.dp, bottomEnd = ${br}.dp, bottomStart = ${bl}.dp)`;
  }
  if (typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
    return `RoundedCornerShape(${node.cornerRadius}.dp)`;
  }
  return null;
}

function composeEffects(node) {
  if (!node || !node.effects || !Array.isArray(node.effects)) return null;
  const parts = [];
  for (const e of node.effects) {
    if (!e || e.visible === false) continue;
    if (e.type === 'DROP_SHADOW') {
      const blur = typeof e.radius === 'number' ? e.radius : 0;
      // Use shadow modifier (Compose 1.6+)
      parts.push(`.shadow(elevation = ${Math.max(blur / 3, 1)}.dp${composeRadius(node) ? ', shape = ' + composeRadius(node) : ''})`);
    }
    if (e.type === 'LAYER_BLUR') {
      const r = typeof e.radius === 'number' ? e.radius : 0;
      parts.push(`.blur(${r}.dp)`);
    }
    if (e.type === 'INNER_SHADOW') {
      parts.push(` // TODO: Inner shadow not directly supported in Compose`);
    }
    if (e.type === 'BACKGROUND_BLUR') {
      parts.push(` // TODO: Background blur requires API 31+ (RenderEffect)`);
    }
  }
  return parts.length ? parts.join('\n            ') : null;
}

function composeText(node, indent, options, colorSet, nextColorIdx) {
  const pad = '    '.repeat(indent);
  const chars = node.characters || '';

  // Try mixed text
  let isMixed = false;
  let segments = [];
  try {
    segments = node.getStyledTextSegments([
      'fontName', 'fontSize', 'fontWeight', 'fills', 'lineHeight',
      'letterSpacing', 'textDecoration', 'textCase'
    ]);
    if (segments && segments.length > 1) isMixed = true;
  } catch (e) {}

  if (isMixed) {
    const spans = segments.map(seg => {
      const styles = composeSpanStyle(seg, colorSet, nextColorIdx);
      const escaped = escapeKotlinString(seg.characters);
      if (styles) {
        return `${pad}        withStyle(SpanStyle(${styles})) {\n${pad}            append("${escaped}")\n${pad}        }`;
      }
      return `${pad}        append("${escaped}")`;
    });

    const comment = node.name ? `${pad}// ${node.name}\n` : '';
    return comment + `${pad}Text(\n${pad}    text = buildAnnotatedString {\n${spans.join('\n')}\n${pad}    }\n${pad})`;
  }

  // Simple text
  const styleParts = [];
  if (options.includeTextStyles) {
    try {
      if (node.fontSize && node.fontSize !== figma.mixed) styleParts.push(`fontSize = ${node.fontSize}.sp`);
    } catch (e) {}

    try {
      if (node.fontName && node.fontName !== figma.mixed) {
        const w = fontWeightFromStyle(node.fontName.style);
        if (w) styleParts.push(`fontWeight = FontWeight(${w})`);
        if (node.fontName.style && /italic/i.test(node.fontName.style)) styleParts.push('fontStyle = FontStyle.Italic');
      }
    } catch (e) {}

    try {
      if (node.fills && Array.isArray(node.fills)) {
        const solid = node.fills.find(f => f && f.visible !== false && f.type === 'SOLID');
        if (solid) styleParts.push(`color = ${composeColor(solid.color, solid.opacity)}`);
      }
    } catch (e) {}

    try {
      if (node.lineHeight && node.lineHeight !== figma.mixed && node.lineHeight.unit === 'PIXELS') {
        styleParts.push(`lineHeight = ${node.lineHeight.value}.sp`);
      }
    } catch (e) {}

    try {
      if (node.letterSpacing && node.letterSpacing !== figma.mixed && node.letterSpacing.unit === 'PIXELS' && node.letterSpacing.value !== 0) {
        styleParts.push(`letterSpacing = ${numF(node.letterSpacing.value)}.sp`);
      }
    } catch (e) {}

    try {
      if (node.textAlignHorizontal) {
        const m = { LEFT: 'TextAlign.Start', CENTER: 'TextAlign.Center', RIGHT: 'TextAlign.End', JUSTIFIED: 'TextAlign.Justify' };
        if (m[node.textAlignHorizontal]) styleParts.push(`textAlign = ${m[node.textAlignHorizontal]}`);
      }
    } catch (e) {}

    try {
      if (node.textDecoration) {
        const m = { UNDERLINE: 'TextDecoration.Underline', STRIKETHROUGH: 'TextDecoration.LineThrough' };
        if (m[node.textDecoration]) styleParts.push(`textDecoration = ${m[node.textDecoration]}`);
      }
    } catch (e) {}
  }

  const escaped = escapeKotlinString(chars);
  const comment = node.name ? `${pad}// ${node.name}\n` : '';

  if (styleParts.length) {
    return comment + `${pad}Text(\n${pad}    text = "${escaped}",\n${pad}    style = TextStyle(\n${pad}        ${styleParts.join(',\n' + pad + '        ')}\n${pad}    )\n${pad})`;
  }
  return comment + `${pad}Text(text = "${escaped}")`;
}

function composeSpanStyle(seg, colorSet, nextColorIdx) {
  const parts = [];
  if (seg.fontSize) parts.push(`fontSize = ${seg.fontSize}.sp`);
  if (seg.fontName) {
    const w = fontWeightFromStyle(seg.fontName.style);
    if (w) parts.push(`fontWeight = FontWeight(${w})`);
    if (seg.fontName.style && /italic/i.test(seg.fontName.style)) parts.push('fontStyle = FontStyle.Italic');
  }
  if (seg.fills && Array.isArray(seg.fills)) {
    const solid = seg.fills.find(f => f && f.visible !== false && f.type === 'SOLID');
    if (solid) parts.push(`color = ${composeColor(solid.color, solid.opacity)}`);
  }
  if (seg.textDecoration) {
    const m = { UNDERLINE: 'TextDecoration.Underline', STRIKETHROUGH: 'TextDecoration.LineThrough' };
    if (m[seg.textDecoration]) parts.push(`textDecoration = ${m[seg.textDecoration]}`);
  }
  return parts.length ? parts.join(', ') : null;
}

function composeImage(resName, altName, w, h, indent, scaleMode) {
  const pad = '    '.repeat(indent);
  const comment = altName ? `${pad}// ${altName}\n` : '';
  const contentScale = composeContentScale(scaleMode);
  return comment +
    `${pad}Image(\n` +
    `${pad}    painter = painterResource(R.drawable.${resName}),\n` +
    `${pad}    contentDescription = ${altName ? '"' + escapeKotlinString(altName) + '"' : 'null'},\n` +
    `${pad}    modifier = Modifier.size(width = ${w}.dp, height = ${h}.dp),\n` +
    `${pad}    contentScale = ${contentScale}\n` +
    `${pad})`;
}

function composeContentScale(scaleMode) {
  const map = {
    FILL: 'ContentScale.Crop',
    FIT: 'ContentScale.Fit',
    CROP: 'ContentScale.Crop',
    TILE: 'ContentScale.None',
  };
  return map[scaleMode] || 'ContentScale.Crop';
}

function composeColor(color, opacity) {
  if (!color) return 'Color.Transparent';
  const r = Math.round((color.r || 0) * 255);
  const g = Math.round((color.g || 0) * 255);
  const b = Math.round((color.b || 0) * 255);
  const a = typeof opacity === 'number' ? opacity : (typeof color.a === 'number' ? color.a : 1);

  if (r === 255 && g === 255 && b === 255 && a === 1) return 'Color.White';
  if (r === 0 && g === 0 && b === 0 && a === 1) return 'Color.Black';
  if (a === 1) return `Color(${r}, ${g}, ${b})`;
  return `Color(${r}, ${g}, ${b}, ${Math.round(a * 255)})`;
}

// ── Output builders ──

function buildComposeSingleOutput(screenName, body, components, colorSet) {
  const imports = composeImports();
  let code = `${imports}\n\n@Composable\nfun ${screenName}() {\n${body}\n}`;

  for (const [name, compBody] of components) {
    code += `\n\n@Composable\nfun ${name}() {\n${compBody}\n}`;
  }
  return code;
}

function buildComposeFileStructure(screenName, body, components, colorSet, imageAssets) {
  const imports = composeImports();

  // Screen.kt
  const screenKt = `package ui\n\n${imports}\nimport ui.components.*\n\n@Composable\nfun ${screenName}() {\n${body}\n}`;

  // Component files
  const componentFiles = {};
  for (const [name, compBody] of components) {
    componentFiles[name] = `package ui.components\n\n${imports}\n\n@Composable\nfun ${name}() {\n${compBody}\n}`;
  }

  // Color.kt
  const colorEntries = [];
  if (colorSet && colorSet.size > 0) {
    for (const [rgba, varName] of colorSet) {
      colorEntries.push(`val ${varName} = ${rgba}`);
    }
  }
  const colorKt = `package ui.theme\n\nimport androidx.compose.ui.graphics.Color\n\nobject AppColors {\n${colorEntries.length ? '    ' + colorEntries.join('\n    ') : '    // Colors extracted from design'}\n}`;

  return {
    mainCode: screenKt,
    screenKt,
    componentFiles,
    colorKt,
    imageAssets
  };
}

function composeImports() {
  return `import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.geometry.Offset`;
}

// ── Naming helpers ──

function composeFunName(name) {
  if (!name) return 'Unnamed';
  // Convert to PascalCase, remove invalid chars
  return name
    .replace(/[^a-zA-Z0-9\s_\-/]/g, '')
    .split(/[\s_\-/]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') || 'Unnamed';
}

function escapeKotlinString(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\$/g, '\\$');
}

function numF(n) {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}
