# UI to HTML Exporter

Figma 디자인을 HTML로 변환하는 Figma 플러그인입니다.

선택한 요소 또는 전체 페이지를 절대 위치(absolute positioning) 기반의 정적 HTML로 추출합니다. 유료/제한적 플러그인 없이도 쓸만한 수준의 HTML 변환을 목표로 합니다.

## 설치

1. Figma Desktop에서 `Plugins > Development > Import plugin from manifest...` 선택
2. 이 프로젝트의 `manifest.json` 파일을 선택

## 사용법

1. Figma에서 내보낼 프레임/요소를 선택
2. 플러그인 실행 (`Plugins > Development > UI to HTML Exporter`)
3. 옵션 설정 후 **Export** 클릭
4. 결과 HTML을 **Copy**(클립보드) 또는 **Download**(.html 파일)로 추출

## 내보내기 옵션

| 옵션 | 기본값 | 설명 |
|---|---|---|
| Include children | ON | 자식 노드 포함 여부 |
| Fills | ON | 배경색/그라디언트 포함 |
| Strokes | ON | 테두리 포함 |
| Radius | ON | border-radius 포함 |
| Shadows | ON | box-shadow(Drop/Inner) 포함 |
| Text styles | ON | 폰트, 크기, 색상 등 텍스트 스타일 포함 |
| Embed images (PNG) | OFF | 이미지 fill이 있는 노드를 PNG base64로 인라인 |
| Rasterize instances/components | OFF | 인스턴스/컴포넌트/벡터를 PNG로 래스터라이즈 (충실도 높지만 편집 불가) |
| Rasterize clipped/masked containers | ON | 마스크/클리핑 컨테이너를 PNG로 래스터라이즈 (마스크 충실도 향상) |

### 추천 설정

- **기본 사용**: 기본값 그대로 사용
- **고충실도**: `Embed images` + `Rasterize instances/components` ON
- **편집 가능한 HTML**: `Rasterize clipped/masked containers` OFF

## 지원 범위

### CSS 매핑

- **배경**: Solid color, Linear gradient
- **테두리**: Solid stroke (Inside/Center/Outside 정렬)
- **모서리**: 균일 및 개별 corner radius
- **그림자**: Drop shadow, Inner shadow
- **텍스트**: color, font-size, font-family, font-weight(Thin~Black), font-style, line-height, letter-spacing, text-align, text-decoration, text-transform
- **기타**: opacity, overflow(clip), 마스크(사각형/타원)

### 알려진 제한사항

- 모든 요소가 `position: absolute`로 배치되어 반응형이 아닙니다
- Figma Auto Layout / Constraints는 반영되지 않습니다
- Radial/Angular/Diamond 그라디언트는 미지원입니다
- 다중 fill 중 첫 번째만 적용됩니다
- Mixed 속성(여러 폰트/크기가 혼합된 텍스트)은 무시됩니다
- Blur 이펙트(Layer/Background blur)는 미지원입니다

## 프로젝트 구조

```
figma-exporter/
├── manifest.json   # Figma 플러그인 매니페스트
├── code.js         # 플러그인 로직 (노드 → HTML 변환)
└── ui.html         # 플러그인 UI 패널
```

## 라이선스

Private
