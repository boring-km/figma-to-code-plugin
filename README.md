# Figma to Code

Figma 디자인을 **Jetpack Compose** 코드 또는 HTML로 변환하는 Figma 플러그인입니다.

Google Relay 종료(2025.04) 이후 Figma → Compose 변환 시장의 공백을 메우기 위해 만들어졌습니다. Figma의 Auto Layout을 Row/Column으로, 컴포넌트를 별도 @Composable 함수로 자동 분리합니다.

## 설치

1. Figma Desktop에서 `Plugins > Development > Import plugin from manifest...` 선택
2. 이 프로젝트의 `manifest.json` 파일을 선택

## 사용법

1. Figma에서 내보낼 프레임/요소를 선택
2. 플러그인 실행 (`Plugins > Development > Figma to Code`)
3. **HTML** 또는 **Compose** 탭 선택
4. 옵션 설정 후 **Export** 클릭
5. 결과를 **Copy**(클립보드) 또는 **Download**(.kt/.html/.zip)로 추출

## Compose 변환

### 설계 결정사항

| 항목 | 결정 |
|------|------|
| Material 버전 | Material 3 (`MaterialTheme.colorScheme`) |
| 출력 형식 | Single function / File structure (ZIP) |
| 컴포넌트 분리 | COMPONENT/INSTANCE → 별도 @Composable fun |
| 이미지 참조 | `painterResource(R.drawable.img_001)` |
| 단위 변환 | 1px = 1dp (1:1) |

### 레이아웃 매핑

| Figma | Compose |
|-------|---------|
| Auto Layout (Horizontal) | `Row(horizontalArrangement, verticalAlignment)` |
| Auto Layout (Vertical) | `Column(verticalArrangement, horizontalAlignment)` |
| Absolute position | `Box + Modifier.offset(x.dp, y.dp)` |
| itemSpacing | `Arrangement.spacedBy()` |
| padding | `Modifier.padding()` |
| flex: 1 | `Modifier.weight(1f)` |

### 파일 구조 모드

```
compose-export.zip
├── ui/
│   ├── Screen.kt
│   ├── components/
│   │   ├── CardComponent.kt
│   │   └── ButtonPrimary.kt
│   └── theme/
│       └── Color.kt
└── res/
    └── drawable/
        ├── img_001.png
        └── img_002.png
```

## HTML 변환

### 내보내기 옵션

| 옵션 | 기본값 | 설명 |
|---|---|---|
| Children | ON | 자식 노드 포함 |
| Fills | ON | 배경색/그라디언트 |
| Strokes | ON | 테두리 |
| Radius | ON | border-radius |
| Shadows/Blur | ON | box-shadow, blur |
| Text styles | ON | 폰트, 크기, 색상 등 |
| Extract images | ON | 이미지를 별도 파일로 추출 |
| Vectors as SVG | ON | 벡터 노드를 인라인 SVG로 |
| Rasterize instances | OFF | 인스턴스/컴포넌트를 PNG로 |
| Rasterize clipped | ON | 마스크/클리핑을 PNG로 |
| CSS variables | OFF | 반복 색상을 CSS 변수로 추출 |

### CSS 매핑

- Auto Layout → Flexbox (flex-direction, gap, padding, justify-content, align-items)
- 다중 fill (Solid, Linear/Radial gradient)
- Border (Inside/Center/Outside), Border-radius (개별 corner)
- Drop shadow, Inner shadow, Layer blur, Background blur
- Mixed text styles (getStyledTextSegments → span)
- data-figma-* 속성 (Compose 변환 메타데이터)

## 알려진 제한사항

- Absolute 배치 요소는 Compose에서 `Box + offset`으로 변환되어 반응형이 아닙니다
- Figma Constraints는 미지원 (Auto Layout 프레임 권장)
- Inner shadow, Background blur는 Compose에 직접 대응 없음 (TODO 코멘트)
- Gradient의 비정형 각도는 근사치
- 자동 생성 코드는 80% 수준의 시작점이며 수동 조정이 필요합니다

자세한 변환 가이드는 [COMPOSE_GUIDE.md](./COMPOSE_GUIDE.md)를 참조하세요.

## 프로젝트 구조

```
figma-to-code/
├── manifest.json       # Figma 플러그인 매니페스트
├── code.js             # 플러그인 로직 (HTML + Compose 변환 엔진)
├── ui.html             # 플러그인 UI (HTML/Compose 탭)
├── COMPOSE_GUIDE.md    # Compose 변환 기술 가이드
└── README.md
```

## 라이선스

Private
