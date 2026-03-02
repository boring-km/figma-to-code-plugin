# Figma → Jetpack Compose 변환 가이드

이 문서는 Figma to Code 플러그인의 Compose 코드 생성에 대한 기술 가이드입니다.
플러그인은 Figma 디자인을 직접 Jetpack Compose 코드로 변환하거나, HTML 중간 출력을 통해 수동 변환할 수 있습니다.

## 목차

1. [변환 설계 결정사항](#1-변환-설계-결정사항)
2. [알려진 제한사항 및 리스크](#2-알려진-제한사항-및-리스크)
3. [프로젝트 셋업](#3-프로젝트-셋업)
4. [HTML 구조 이해](#4-html-구조-이해)
5. [레이아웃 매핑](#5-레이아웃-매핑)
6. [스타일 매핑](#6-스타일-매핑)
7. [텍스트 매핑](#7-텍스트-매핑)
8. [이미지 매핑](#8-이미지-매핑)
9. [data-figma-* 속성 파싱](#9-data-figma--속성-파싱)
10. [완성 예시](#10-완성-예시)

---

## 1. 변환 설계 결정사항

| 항목 | 결정 | 근거 |
|------|------|------|
| **Material 버전** | Material 3 | 최신 Android 프로젝트 표준. `MaterialTheme.colorScheme` 사용 |
| **출력 형식** | @Composable 함수 + 파일 구조(ZIP) 둘 다 지원 | 단일 함수는 빠른 복사용, 파일 구조는 프로젝트 통합용 |
| **컴포넌트 분리** | Figma COMPONENT/INSTANCE → 별도 @Composable fun | 재사용 가능한 코드 생성 |
| **이미지 참조** | `painterResource(R.drawable.img_001)` | 로컬 리소스 기반. ZIP에 drawable 포함 |
| **단위 변환** | 1px = 1dp (1:1) | Figma의 px을 그대로 dp로 매핑. 업계 표준 |
| **HTML 출력** | 병행 지원 | UI에서 HTML/Compose 탭 전환 |

### 파일 구조 모드 출력

```
compose-export.zip
├── ui/
│   ├── Screen.kt              ← 메인 @Composable
│   ├── components/
│   │   ├── CardComponent.kt   ← Figma COMPONENT별 분리
│   │   └── ButtonPrimary.kt
│   └── theme/
│       ├── Color.kt           ← 추출된 색상 상수
│       └── Type.kt            ← 추출된 텍스트 스타일
└── res/
    └── drawable/
        ├── img_001.png
        └── img_002.png
```

---

## 2. 알려진 제한사항 및 리스크

### 높은 리스크

**레이아웃 매핑 한계**
- Figma에서 Auto Layout 없이 absolute로 배치된 요소는 `Box + Modifier.offset()`으로 변환됩니다. 이는 **다른 화면 크기에서 깨질 수 있습니다.**
- Figma의 Constraints(좌측 고정, 우측 고정 등)를 Compose의 `fillMaxWidth`, `wrapContentSize` 등으로 정확히 매핑하기 어렵습니다.
- **권장**: Auto Layout을 사용한 프레임 위주로 디자인하면 변환 품질이 크게 향상됩니다.

**중첩 레이아웃 성능**
- Figma는 수십 레벨 중첩이 흔한데, 그대로 Row/Column/Box로 변환하면 Compose recomposition 성능 문제가 발생할 수 있습니다.
- 생성된 코드를 검토하여 불필요한 래핑을 제거하는 것을 권장합니다.

**텍스트 스타일 정밀도**
- Mixed text(`getStyledTextSegments`)를 `AnnotatedString`으로 변환하지만, line-height, letter-spacing 등이 미세하게 다를 수 있습니다.
- Figma의 line-height는 행 중앙 기준, Compose는 행 위 기준이라 수직 정렬에 차이가 생깁니다.

### 중간 리스크

**폰트 가용성**
- Figma에서 사용한 폰트(Inter, Pretendard 등)가 Android 프로젝트에 없을 수 있습니다. `res/font/`에 폰트 파일을 추가하거나, 생성된 코드에서 `FontFamily.Default`로 fallback됩니다.

**Shadow/Blur Compose 제한**
- CSS `box-shadow`는 Compose에 직접 대응이 없습니다. `elevation`은 근사치이며, 정확한 재현은 커스텀 `drawBehind`가 필요합니다.
- `backdrop-filter: blur()`는 API 31+(Android 12) 이상에서만 사용 가능합니다.
- Inner shadow는 Compose에 내장 지원이 없어 커스텀 구현이 필요합니다.
- 변환 불가능한 효과는 `// TODO:` 코멘트로 표시됩니다.

**Gradient 정밀도**
- Figma의 `gradientTransform` (2x3 매트릭스)를 Compose의 `Brush.linearGradient(start, end)`로 정확히 변환하기 어렵습니다.
- 단순 각도(0/90/180/270)는 정확하지만, 비정형 각도는 근사치가 됩니다.

**컴포넌트 이름 충돌**
- Figma에서 "Button", "Card" 같은 이름이 Compose 기본 컴포넌트와 충돌할 수 있습니다.
- 같은 이름의 컴포넌트가 여러 개 있을 경우 넘버링으로 구분됩니다.

### 낮은 리스크

**이미지 해상도**
- 1x로 추출하면 고해상도 디바이스에서 흐릿해질 수 있습니다. 2x 또는 3x 스케일 추출을 권장합니다.
- SVG 벡터는 `VectorDrawable`로 수동 변환이 필요합니다.

**postMessage 크기**
- 매우 많은 노드 + 이미지가 있으면 Figma 플러그인의 메시지 크기 제한에 걸릴 수 있습니다.

**생성 코드 가독성**
- 자동 생성 코드는 수동 작성보다 가독성이 떨어질 수 있습니다. Figma 레이어 이름이 코멘트로 추가되어 구조 파악을 돕습니다.

### 변환 정확도 기대치

이 플러그인은 **Pixel-perfect 변환이 아닌, 80% 수준의 작업 시작점**을 제공합니다. 생성된 코드를 기반으로 수동 조정이 필요합니다:

- Auto Layout 프레임 → Row/Column: **높은 정확도**
- Absolute 배치 → Box + offset: **중간 정확도** (화면 크기 대응 필요)
- 색상/크기/패딩: **높은 정확도**
- Shadow/Blur 효과: **낮은 정확도** (수동 구현 필요)
- 복잡한 마스크/클리핑: **래스터라이즈 fallback**

---

## 3. 프로젝트 셋업

### build.gradle.kts (app)

```kotlin
dependencies {
    // Compose BOM
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.9.3")

    // 이미지 로딩 (로컬 리소스 사용 시 불필요)
    implementation("io.coil-kt:coil-compose:2.7.0")
}
```

### 이미지 리소스 배치

ZIP에서 추출한 `images/` 폴더의 PNG 파일들을 Android 리소스로 변환:

```
images/img-001.png → app/src/main/res/drawable/img_001.png
images/img-002.png → app/src/main/res/drawable/img_002.png
```

파일명의 하이픈(`-`)을 언더스코어(`_`)로 변경해야 합니다.

---

## 4. HTML 구조 이해

### data-figma-* 속성

플러그인이 출력한 HTML의 모든 요소에는 Compose 변환에 필요한 메타데이터가 포함되어 있습니다:

| 속성 | 설명 | 예시 |
|------|------|------|
| `data-figma-type` | Figma 노드 타입 | `FRAME`, `TEXT`, `INSTANCE`, `VECTOR` |
| `data-figma-name` | Figma 레이어 이름 | `Header`, `Button/Primary` |
| `data-figma-layout` | Auto Layout 방향 | `HORIZONTAL`, `VERTICAL` |
| `data-figma-spacing` | itemSpacing (px) | `8` |
| `data-figma-padding` | padding (top,right,bottom,left) | `12,16,12,16` |
| `data-figma-fills` | Fill 데이터 (JSON) | `[{"type":"SOLID","color":{"r":0.1,"g":0.2,"b":0.3},"opacity":1}]` |
| `data-figma-effects` | Effect 데이터 (JSON) | `[{"type":"DROP_SHADOW","radius":4,...}]` |
| `data-figma-radius` | Border radius (JSON) | `{"tl":8,"tr":8,"br":8,"bl":8}` |
| `data-figma-opacity` | 투명도 | `0.5` |

### CSS 클래스

| 클래스 | 의미 | Compose 대응 |
|--------|------|-------------|
| `figma-abs` | absolute positioning | `Modifier.offset(x.dp, y.dp)` |
| `figma-clip` | overflow: hidden | `Modifier.clip(shape)` |
| `figma-text` | 텍스트 노드 | `Text()` composable |
| `figma-img` | 이미지 | `Image()` composable |

---

## 5. 레이아웃 매핑

### Auto Layout → Row / Column

```html
<!-- HTML: 가로 Auto Layout -->
<div class="figma-node" style="display:flex;flex-direction:row;gap:8px;padding:12px 16px;"
     data-figma-layout="HORIZONTAL" data-figma-spacing="8" data-figma-padding="12,16,12,16">
  <div>Child 1</div>
  <div>Child 2</div>
</div>
```

```kotlin
// Compose
Row(
    modifier = Modifier.padding(vertical = 12.dp, horizontal = 16.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp)
) {
    Child1()
    Child2()
}
```

### 세로 Auto Layout → Column

```html
<div data-figma-layout="VERTICAL" data-figma-spacing="12" data-figma-padding="16,16,16,16">
```

```kotlin
Column(
    modifier = Modifier.padding(16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)
) { ... }
```

### Absolute Positioning → Box + offset

```html
<!-- HTML: 절대 위치 -->
<div class="figma-node figma-abs" style="left:100px;top:50px;width:200px;height:40px;">
```

```kotlin
// Compose
Box(
    modifier = Modifier
        .offset(x = 100.dp, y = 50.dp)
        .size(width = 200.dp, height = 40.dp)
)
```

### 정렬 매핑

| CSS (HTML) | Compose (Row) | Compose (Column) |
|------------|---------------|-------------------|
| `justify-content:flex-start` | `Arrangement.Start` | `Arrangement.Top` |
| `justify-content:center` | `Arrangement.Center` | `Arrangement.Center` |
| `justify-content:flex-end` | `Arrangement.End` | `Arrangement.Bottom` |
| `justify-content:space-between` | `Arrangement.SpaceBetween` | `Arrangement.SpaceBetween` |
| `align-items:flex-start` | `Alignment.Top` | `Alignment.Start` |
| `align-items:center` | `Alignment.CenterVertically` | `Alignment.CenterHorizontally` |
| `align-items:flex-end` | `Alignment.Bottom` | `Alignment.End` |

### flex:1 → weight(1f)

```html
<div style="flex:1;height:40px;">
```

```kotlin
Box(modifier = Modifier.weight(1f).height(40.dp))
```

---

## 6. 스타일 매핑

### 배경색

```html
<div style="background:rgba(34,197,94,1);">
```

```kotlin
Modifier.background(Color(34, 197, 94, 255))
```

`data-figma-fills`에서 정확한 Figma 색상값을 얻을 수 있습니다:

```kotlin
// data-figma-fills='[{"type":"SOLID","color":{"r":0.133,"g":0.773,"b":0.369},"opacity":1}]'
val color = Color(
    red = 0.133f,
    green = 0.773f,
    blue = 0.369f,
    alpha = 1f
)
```

### Linear Gradient

```html
<div style="background:linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(0,0,0,1) 100%);">
```

```kotlin
Modifier.background(
    brush = Brush.linearGradient(
        colors = listOf(Color.White, Color.Black),
        start = Offset(0f, 0f),
        end = Offset(0f, Float.POSITIVE_INFINITY)
    )
)
```

### Radial Gradient

```html
<div style="background:radial-gradient(ellipse at 50% 50%, rgba(255,0,0,1) 0%, rgba(0,0,255,1) 100%);">
```

```kotlin
Modifier.background(
    brush = Brush.radialGradient(
        colors = listOf(Color.Red, Color.Blue),
        center = Offset(0.5f, 0.5f)  // 비율
    )
)
```

### Border Radius

```html
<div style="border-radius:8px 8px 0px 0px;" data-figma-radius='{"tl":8,"tr":8,"br":0,"bl":0}'>
```

```kotlin
Modifier.clip(
    RoundedCornerShape(
        topStart = 8.dp,
        topEnd = 8.dp,
        bottomEnd = 0.dp,
        bottomStart = 0.dp
    )
)
```

### Border (Stroke)

```html
<div style="border:1px solid rgba(0,0,0,0.12);">
```

```kotlin
Modifier.border(
    width = 1.dp,
    color = Color(0f, 0f, 0f, 0.12f),
    shape = RoundedCornerShape(8.dp)  // radius가 있으면 함께 적용
)
```

### Box Shadow

CSS `box-shadow`는 Compose에 직접 대응이 없습니다. `elevation` 또는 커스텀 `drawBehind`를 사용합니다.

```html
<div style="box-shadow:0px 4px 12px 0px rgba(0,0,0,0.15);">
```

```kotlin
// 방법 1: elevation (Material3 Card)
Card(
    elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
) { ... }

// 방법 2: 커스텀 shadow
Modifier.drawBehind {
    drawIntoCanvas { canvas ->
        val paint = Paint().apply {
            color = Color(0f, 0f, 0f, 0.15f)
            asFrameworkPaint().apply {
                maskFilter = BlurMaskFilter(12.dp.toPx(), BlurMaskFilter.Blur.NORMAL)
            }
        }
        canvas.drawRoundRect(
            0f, 4.dp.toPx(), size.width, size.height + 4.dp.toPx(),
            8.dp.toPx(), 8.dp.toPx(), paint
        )
    }
}
```

### Inner Shadow

```html
<div style="box-shadow:inset 0px 2px 4px 0px rgba(0,0,0,0.1);">
```

```kotlin
// Compose에 내장 지원이 없음. drawWithContent로 구현:
Modifier.drawWithContent {
    drawContent()
    // 위에서 아래로 그림자 오버레이
    drawRect(
        brush = Brush.verticalGradient(
            colors = listOf(Color(0f, 0f, 0f, 0.1f), Color.Transparent),
            startY = 0f,
            endY = 4.dp.toPx()
        )
    )
}
```

### Opacity

```html
<div style="opacity:0.5;" data-figma-opacity="0.5">
```

```kotlin
Modifier.alpha(0.5f)
```

### Blur

```html
<!-- Layer Blur -->
<div style="filter:blur(10px);">

<!-- Background Blur (글래스모피즘) -->
<div style="backdrop-filter:blur(20px);">
```

```kotlin
// Layer Blur (API 31+)
Modifier.blur(10.dp)

// Background Blur - Compose에 직접 지원 없음
// RenderEffect 또는 커스텀 구현 필요:
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    Modifier.graphicsLayer {
        renderEffect = RenderEffect.createBlurEffect(20f, 20f, Shader.TileMode.CLAMP)
            .asComposeRenderEffect()
    }
}
```

### Overflow Hidden (Clip)

```html
<div class="figma-clip" style="border-radius:12px;">
```

```kotlin
Modifier.clip(RoundedCornerShape(12.dp))
```

---

## 7. 텍스트 매핑

### 기본 텍스트

```html
<div class="figma-text" style="font-size:16px;font-weight:700;color:rgba(0,0,0,1);font-family:Inter;text-align:center;"
     data-figma-type="TEXT" data-figma-name="Title">
  Hello World
</div>
```

```kotlin
Text(
    text = "Hello World",
    style = TextStyle(
        fontSize = 16.sp,
        fontWeight = FontWeight.Bold,
        color = Color.Black,
        fontFamily = FontFamily(Font(R.font.inter)),
        textAlign = TextAlign.Center
    )
)
```

### Mixed 텍스트 스타일 (AnnotatedString)

```html
<div class="figma-text">
  <span style="font-weight:700;color:rgba(0,0,0,1);">Bold </span>
  <span style="font-style:italic;color:rgba(255,0,0,1);">Red Italic</span>
</div>
```

```kotlin
Text(
    text = buildAnnotatedString {
        withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = Color.Black)) {
            append("Bold ")
        }
        withStyle(SpanStyle(fontStyle = FontStyle.Italic, color = Color.Red)) {
            append("Red Italic")
        }
    }
)
```

### 텍스트 속성 매핑표

| CSS | Compose TextStyle |
|-----|-------------------|
| `font-size:16px` | `fontSize = 16.sp` |
| `font-weight:700` | `fontWeight = FontWeight.Bold` |
| `font-weight:400` | `fontWeight = FontWeight.Normal` |
| `font-style:italic` | `fontStyle = FontStyle.Italic` |
| `color:rgba(r,g,b,a)` | `color = Color(r,g,b,a)` |
| `font-family:Inter` | `fontFamily = FontFamily(Font(R.font.inter))` |
| `line-height:24px` | `lineHeight = 24.sp` |
| `letter-spacing:0.5px` | `letterSpacing = 0.5.sp` |
| `text-align:center` | `textAlign = TextAlign.Center` |
| `text-decoration:underline` | `textDecoration = TextDecoration.Underline` |
| `text-decoration:line-through` | `textDecoration = TextDecoration.LineThrough` |
| `text-transform:uppercase` | 코드에서 `.uppercase()` 처리 |

### font-weight 숫자 매핑

| CSS weight | Compose FontWeight |
|------------|-------------------|
| 100 | `FontWeight.Thin` |
| 200 | `FontWeight.ExtraLight` |
| 300 | `FontWeight.Light` |
| 400 | `FontWeight.Normal` |
| 500 | `FontWeight.Medium` |
| 600 | `FontWeight.SemiBold` |
| 700 | `FontWeight.Bold` |
| 800 | `FontWeight.ExtraBold` |
| 900 | `FontWeight.Black` |

---

## 8. 이미지 매핑

### 로컬 리소스

```html
<img class="figma-img" src="images/img-001.png">
```

```kotlin
Image(
    painter = painterResource(R.drawable.img_001),
    contentDescription = null,
    modifier = Modifier.fillMaxSize(),
    contentScale = ContentScale.Crop  // figma-img의 object-fit:cover에 대응
)
```

### SVG 벡터

HTML에 인라인 SVG로 포함된 벡터는 Android Vector Drawable로 변환합니다:

1. SVG 코드를 별도 `.svg` 파일로 저장
2. Android Studio의 `Vector Asset` 도구로 변환 (`Resource Manager > + > Vector Asset`)
3. 또는 [svg2android](https://inloop.github.io/svg2android/) 온라인 도구 사용

```kotlin
Image(
    painter = painterResource(R.drawable.ic_vector_001),
    contentDescription = null
)
```

### Retina 이미지 (2x, 3x)

2x/3x 스케일로 추출한 이미지는 Android density qualifier 폴더에 배치:

```
1x → res/drawable-mdpi/img_001.png
2x → res/drawable-xhdpi/img_001.png
3x → res/drawable-xxhdpi/img_001.png
```

---

## 9. data-figma-* 속성 파싱

HTML을 프로그래밍적으로 파싱하여 Compose 코드를 생성할 수 있습니다. 다음은 Kotlin 예제입니다.

### Figma Color → Compose Color

```kotlin
data class FigmaColor(val r: Float, val g: Float, val b: Float)
data class FigmaFill(val type: String, val color: FigmaColor?, val opacity: Float?)

fun FigmaFill.toComposeColor(): Color? {
    if (type != "SOLID" || color == null) return null
    return Color(
        red = color.r,
        green = color.g,
        blue = color.b,
        alpha = opacity ?: 1f
    )
}
```

### Figma Radius → Compose Shape

```kotlin
data class FigmaRadius(val tl: Int, val tr: Int, val br: Int, val bl: Int)

fun FigmaRadius.toComposeShape(): Shape {
    if (tl == tr && tr == br && br == bl) {
        return RoundedCornerShape(tl.dp)
    }
    return RoundedCornerShape(
        topStart = tl.dp,
        topEnd = tr.dp,
        bottomEnd = br.dp,
        bottomStart = bl.dp
    )
}
```

### Figma Layout → Compose Layout

```kotlin
fun buildLayout(
    layout: String?,      // data-figma-layout
    spacing: Int?,        // data-figma-spacing
    padding: String?,     // data-figma-padding ("12,16,12,16")
    content: @Composable () -> Unit
) {
    val paddingValues = padding?.split(",")?.map { it.trim().toIntOrNull()?.dp ?: 0.dp }
    val mod = Modifier.padding(
        top = paddingValues?.getOrNull(0) ?: 0.dp,
        end = paddingValues?.getOrNull(1) ?: 0.dp,
        bottom = paddingValues?.getOrNull(2) ?: 0.dp,
        start = paddingValues?.getOrNull(3) ?: 0.dp
    )

    when (layout) {
        "HORIZONTAL" -> Row(
            modifier = mod,
            horizontalArrangement = Arrangement.spacedBy(spacing?.dp ?: 0.dp)
        ) { content() }

        "VERTICAL" -> Column(
            modifier = mod,
            verticalArrangement = Arrangement.spacedBy(spacing?.dp ?: 0.dp)
        ) { content() }

        else -> Box(modifier = mod) { content() }
    }
}
```

### HTML 파싱 예제 (Jsoup)

```kotlin
// build.gradle.kts
implementation("org.jsoup:jsoup:1.18.3")

// 파싱 코드
val doc = Jsoup.parse(htmlString)
val elements = doc.select("[data-figma-type]")

for (element in elements) {
    val type = element.attr("data-figma-type")
    val name = element.attr("data-figma-name")
    val layout = element.attr("data-figma-layout").ifEmpty { null }
    val fills = element.attr("data-figma-fills").ifEmpty { null }
    val radius = element.attr("data-figma-radius").ifEmpty { null }

    println("$name ($type) layout=$layout")
    // → "Header (FRAME) layout=HORIZONTAL"
}
```

---

## 10. 완성 예시

### 입력: 카드 컴포넌트 HTML

```html
<div class="figma-node" style="width:320px;display:flex;flex-direction:column;gap:12px;padding:16px;
    background:rgba(255,255,255,1);border-radius:12px;box-shadow:0px 2px 8px 0px rgba(0,0,0,0.1);"
    data-figma-type="FRAME" data-figma-name="Card"
    data-figma-layout="VERTICAL" data-figma-spacing="12" data-figma-padding="16,16,16,16"
    data-figma-fills='[{"type":"SOLID","color":{"r":1,"g":1,"b":1},"opacity":1}]'
    data-figma-radius='{"tl":12,"tr":12,"br":12,"bl":12}'>

  <div class="figma-node" style="width:288px;height:160px;" data-figma-type="FRAME" data-figma-name="Thumbnail">
    <img class="figma-img" alt="" src="images/img-001.png">
  </div>

  <div class="figma-node figma-text" style="font-size:18px;font-weight:700;color:rgba(15,23,42,1);"
       data-figma-type="TEXT" data-figma-name="Title">
    Card Title
  </div>

  <div class="figma-node figma-text" style="font-size:14px;font-weight:400;color:rgba(100,116,139,1);line-height:20px;"
       data-figma-type="TEXT" data-figma-name="Description">
    This is a description text that explains the card content.
  </div>

  <div class="figma-node" style="width:288px;height:40px;display:flex;flex-direction:row;gap:0px;padding:0px;
      justify-content:center;align-items:center;background:rgba(34,197,94,1);border-radius:8px;"
      data-figma-type="FRAME" data-figma-name="Button"
      data-figma-layout="HORIZONTAL" data-figma-spacing="0" data-figma-padding="0,0,0,0">
    <div class="figma-node figma-text" style="font-size:14px;font-weight:600;color:rgba(255,255,255,1);"
         data-figma-type="TEXT" data-figma-name="ButtonLabel">
      Get Started
    </div>
  </div>
</div>
```

### 출력: Compose 코드

```kotlin
@Composable
fun CardComponent() {
    Column(
        modifier = Modifier
            .width(320.dp)
            .background(Color.White, RoundedCornerShape(12.dp))
            .clip(RoundedCornerShape(12.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Thumbnail
        Image(
            painter = painterResource(R.drawable.img_001),
            contentDescription = "Thumbnail",
            modifier = Modifier
                .fillMaxWidth()
                .height(160.dp),
            contentScale = ContentScale.Crop
        )

        // Title
        Text(
            text = "Card Title",
            style = TextStyle(
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                color = Color(15, 23, 42)
            )
        )

        // Description
        Text(
            text = "This is a description text that explains the card content.",
            style = TextStyle(
                fontSize = 14.sp,
                fontWeight = FontWeight.Normal,
                color = Color(100, 116, 139),
                lineHeight = 20.sp
            )
        )

        // Button
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(40.dp)
                .background(Color(34, 197, 94), RoundedCornerShape(8.dp)),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Get Started",
                style = TextStyle(
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White
                )
            )
        }
    }
}
```

---

## 변환 체크리스트

- [ ] HTML 파일에서 최상위 `data-figma-layout` 확인 → Row/Column/Box 결정
- [ ] `data-figma-fills`로 배경색/그라디언트 변환
- [ ] `data-figma-radius`로 RoundedCornerShape 생성
- [ ] `data-figma-effects`로 shadow/blur 처리
- [ ] `figma-text` 클래스 → Text() composable
- [ ] `figma-img` 클래스 → Image() composable
- [ ] `flex:1` → `Modifier.weight(1f)`
- [ ] `images/*.png` → `res/drawable/` 리소스 등록
- [ ] SVG 벡터 → Vector Drawable 변환
- [ ] 폰트 파일 → `res/font/` 등록
