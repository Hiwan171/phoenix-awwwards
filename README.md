# Phoenix — A Cycle in Five Acts

Site de scrollytelling 3D (WebGL / Three.js) feito para submissão ao Awwwards.
Uma fênix rigada e animada, com fogo em GLSL, nasce de cinza num hero cinematográfico.

> **Para retomar o trabalho, leia [HANDOFF.md](HANDOFF.md)** (estado, decisões e pendências)
> e depois [DESIGN-BRIEF.md](DESIGN-BRIEF.md).

## Rodar
```bash
cd site
npm install
npm run dev        # http://localhost:5173
```

| Página | O que é |
|---|---|
| `/` | hero: loader → vórtice de cinza → fênix → ignição |
| `/sky.html` | laboratório do céu (céu procedural + fênix) |
| `/sky.html?toy=1` | céu do Shadertoy (o escolhido) atrás da fênix |

## Estrutura
```
site/        app Vite (Three.js + GSAP) — o que vai para produção
tools/       scripts Node: rig, otimização do GLB, QA em navegador headless
assets/source/   GLB original gerado no Tripo (fonte do rig)
fire-test.html   teste isolado do fogo em GLSL
```

## Regenerar os GLBs a partir da fonte
```bash
cd tools && npm install
node build-rig.mjs ../assets/source/tripo_pbr_model_*.glb ../phoenix-rigged.glb
node optimize.mjs ../phoenix-rigged.glb ../site/public/models/phoenix-web.glb 2048 2048 1024
node optimize.mjs ../phoenix-rigged.glb ../site/public/models/phoenix-lite.glb 1024 1024 512
```

## Atenção: licença do shader do céu
`site/src/toy/sky.glsl` vem do Shadertoy (`XsBXDc`). Autor e licença ainda **não foram confirmados**
(o Shadertoy usa CC BY-NC-SA 3.0 por padrão). Resolver antes de publicar ou submeter.
