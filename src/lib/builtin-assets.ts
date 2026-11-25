import type { ProjectAsset } from "@contracts/invitation";

function botanicalSvg(side: "outside" | "inside"): string {
  const isOutside = side === "outside";
  const accent = isOutside ? "#6E7254" : "#8B7658";
  const secondary = isOutside ? "#9A6B4F" : "#A69A7B";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1403" height="992" viewBox="0 0 1403 992">
  <rect width="1403" height="992" fill="#F4EBDD"/>
  <rect x="24" y="24" width="1355" height="944" rx="4" fill="none" stroke="${accent}" stroke-opacity=".26" stroke-width="2"/>
  <path d="M0 720 C145 690 178 565 245 448 C287 375 339 331 391 290" fill="none" stroke="${accent}" stroke-width="3" stroke-opacity=".55"/>
  <path d="M63 690 C42 625 57 576 116 544 C126 609 111 653 63 690Z" fill="${accent}" fill-opacity=".14" stroke="${accent}" stroke-opacity=".5"/>
  <path d="M137 580 C115 516 141 467 196 446 C195 506 177 548 137 580Z" fill="${accent}" fill-opacity=".1" stroke="${accent}" stroke-opacity=".45"/>
  <path d="M208 477 C189 423 212 379 267 357 C265 410 248 449 208 477Z" fill="${accent}" fill-opacity=".12" stroke="${accent}" stroke-opacity=".45"/>
  <path d="M118 605 C176 591 214 612 232 666 C174 669 138 650 118 605Z" fill="${secondary}" fill-opacity=".09" stroke="${secondary}" stroke-opacity=".45"/>
  <path d="M206 492 C265 485 302 509 313 562 C258 559 224 539 206 492Z" fill="${secondary}" fill-opacity=".08" stroke="${secondary}" stroke-opacity=".4"/>
  <g transform="translate(1403 0) scale(-1 1)">
    <path d="M0 720 C145 690 178 565 245 448 C287 375 339 331 391 290" fill="none" stroke="${accent}" stroke-width="3" stroke-opacity=".55"/>
    <path d="M63 690 C42 625 57 576 116 544 C126 609 111 653 63 690Z" fill="${accent}" fill-opacity=".14" stroke="${accent}" stroke-opacity=".5"/>
    <path d="M137 580 C115 516 141 467 196 446 C195 506 177 548 137 580Z" fill="${accent}" fill-opacity=".1" stroke="${accent}" stroke-opacity=".45"/>
    <path d="M208 477 C189 423 212 379 267 357 C267 410 248 449 208 477Z" fill="${accent}" fill-opacity=".12" stroke="${accent}" stroke-opacity=".45"/>
    <path d="M118 605 C176 591 214 612 232 666 C174 669 138 650 118 605Z" fill="${secondary}" fill-opacity=".09" stroke="${secondary}" stroke-opacity=".45"/>
  </g>
  <path d="M650 48 Q701 25 753 48" fill="none" stroke="${secondary}" stroke-width="2" stroke-opacity=".5"/>
  <circle cx="701" cy="37" r="4" fill="${secondary}" fill-opacity=".65"/>
</svg>`;
}

export function getBuiltinAssetUrl(builtinId: string): string {
  const side = builtinId === "botanical-inside" ? "inside" : "outside";
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(botanicalSvg(side))}`;
}

export type AssetUrlMap = Record<string, string>;

export function resolveAssetUrls(assets: ProjectAsset[], uploadedUrls: AssetUrlMap): AssetUrlMap {
  return Object.fromEntries(assets.map((asset) => [
    asset.id,
    asset.source === "builtin"
      ? getBuiltinAssetUrl(asset.builtinId || "botanical-outside")
      : asset.source === "generated" && asset.generatedSvg
        ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.generatedSvg)}`
        : uploadedUrls[asset.id] || "",
  ]));
}
