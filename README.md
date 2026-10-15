# Phoenix — A Cycle in Five Acts

Site de scrollytelling 3D (WebGL / Three.js) feito para submissão ao Awwwards.
Uma fênix esculpida, rigada e animada, colorida por código (plumagem procedural) e com aura de chamas em GLSL,
voa diante de um céu de entardecer num hero cinematográfico.

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
| `/` | hero: céu do entardecer (Shadertoy) + fênix v2 colorida, com aura de chamas |
| `/sky.html` | laboratório (sliders do céu procedural; `?toy=1` = o céu do hero + `?look=`, `?aura=`, `?pl=`, `?dbg=`...) |
| `/sky.html?toy=1` | céu do Shadertoy (o escolhido) atrás da fênix |
| `/fly.html` | voo: a fênix cruza a câmera, mergulha e sobe, guiada pelo scroll (Espaço = voo automático) |

## Estrutura
```
site/            app Vite (Three.js + GSAP): o que vai para produção
  src/           main.js (boot), stage.js (cena do hero), phoenix-material.js, plumage.js, flame-aura.js,
                 toy-sky.js + toy/sky.glsl (céu), looks.js, shaders.js, sky-test.js (laboratório)
  _archive/      intro-ember (abertura antiga) e scroll-slice (atos antigos): não usar sem pedir
tools/           scripts Node: prep + rig do GLB (make-phoenix.sh), inspeção, QA em navegador headless
model/           GLB esculpido bruto (fonte do rig) + intermediários (ignorados pelo git)
assets/source/   GLB da primeira fênix (Tripo), legado
```

## Gerar a fênix (modelo → GLBs web/lite)
```bash
cd tools && npm install
bash make-phoenix.sh ../model/model.glb   # prepara, faz o rig, otimiza -> site/public/models/phoenix-v2-{web,lite}.glb
```

## Atenção: licença do shader do céu
`site/src/toy/sky.glsl` vem do Shadertoy (`XsBXDc`). Autor e licença ainda **não foram confirmados**
(o Shadertoy usa CC BY-NC-SA 3.0 por padrão). Resolver antes de publicar ou submeter.
