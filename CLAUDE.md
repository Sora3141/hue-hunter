# DELTA HUE（id は hue-hunter）

T.OF... のアプリ。https://t-of.github.io/hue-hunter/

- ルールは本部の `~/GitHub/tof/t-of.github.io/RULES.md` に従う（全アプリ共通）。ブランドは `docs/BRAND.md`。
- 直したら本部で `npm run audit:browser -- hue-hunter` を通す。
- 公開は本部の `docs/RELEASE.md` の手順。大きな作業は本部で Claude を起動すると、役割を分けて進められる。
- localStorage のキーは `hueHunter_` で始める（旧名 Hue Hunter のころからの記録があるので変えない）。SW のキャッシュ名は `hue-hunter-` で始める。
