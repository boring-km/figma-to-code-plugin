// Figma Plugin: UI to HTML Exporter v2
// Exports selected nodes or the whole page as HTML with Compose-ready metadata.
// Features: Auto Layout→Flexbox, multi-fill, radial gradient, blur, SVG vectors,
// mixed text styles, image format/scale, CSS variables, progress tracking.

figma.showUI(__html__, { width: 760, height: 580 });

// ── Main handler ──

figma.ui.onmessage = async (msg) => {
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
