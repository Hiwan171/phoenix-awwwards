# Phoenix — A Cycle in Five Acts

## Estado atual — 20/10/2026

A cena de trabalho está na branch **`v2`**, em `/opening-lab.html`: fênix articulada, céu vermelho com estrelas e cometas,
montanhas com material de rocha, vale e lago refletivo, voo ampliado e pouso final. Consulte [HERO-NOTES.md](HERO-NOTES.md)
e a seção mais recente de [HANDOFF.md](HANDOFF.md) para continuar deste ponto.

Para retomar em outra máquina, no repositório:

```bash
git switch v2
git pull --ff-only origin v2
git lfs pull
cd site
npm ci
npm run dev
```

Abra `http://localhost:5173/opening-lab.html?play=1&dur=45&ui=0`. A reprodução termina com a fênix pousada.
Os modelos, mapas de plumagem e texturas necessários para rodar já estão versionados. Para usar as ferramentas de QA,
instale também as dependências em `tools` com `npm ci`. As seções abaixo registram também etapas anteriores do projeto.

Site de scrollytelling 3D (WebGL / Three.js) feito para submissão ao Awwwards (meta: Honorable Mention).
Hoje a página é **só o shader do céu de entardecer** (Shadertoy) com bloom, em tela cheia, e um governador de qualidade: o hero
será refeito do zero. A cena inicial terá uma
**fênix nova**, e o dragão e outras feras entram em outras cenas, todas no mesmo estilo (a textura própria do dragão).

> **Para retomar o trabalho, leia [HANDOFF.md](HANDOFF.md)** (estado, decisões, receita para trazer uma fera, o que medimos de
> performance) e depois [DESIGN-BRIEF.md](DESIGN-BRIEF.md).
> A fênix v2 anterior foi removida em 15/10/2026; está no git (`0a0f28f` / `origin/v2`).

## Rodar
```bash
cd site
npm install
npm run dev        # http://localhost:5173
```

| URL | O que é |
|---|---|
| `/opening-lab.html?play=1&dur=30&loop=1` | abertura restaurada do vídeo: céu vermelho, dois picos e a fênix voando de um ao outro; Espaço pausa, R reinicia, H esconde os controles |
| `/` | o shader do céu do Shadertoy com bloom, sozinho, em tela cheia (sem transição, texto nem HUD) |
| `/?q=N` | fixa o tier de qualidade (0 = look aprovado … 5 = o mais leve) |
| `/?gov=0` | desliga o governador de qualidade (fica no tier 0) |
| `/?qa=1` | tier fixo e relógio congelável (`S.t`): para capturas determinísticas |

## Estrutura
```
site/            app Vite (Three.js + GSAP): o que vai para produção
  src/           main.js (boot), stage.js (palco: céu, luz, compositor, governador), hero-post.js (pós fundido),
                 flame-aura.js (campo de chama da aura), toy-sky.js + toy/sky.glsl (céu), looks.js, style.css
  _archive/      intro-ember (abertura antiga) e scroll-slice (atos antigos): não usar sem pedir
tools/           scripts Node: prep-model (solda + decima GLB), optimize (WebP + Meshopt), inspect, QA em navegador headless
model/dragon/    o dragão (GLB bruto do gerador, ainda sem otimização para web)
```

## Trazer uma fera nova (GLB do gerador → web)
```bash
cd tools && npm install
node inspect.mjs ../model/dragon/dragon.glb                      # estrutura, tamanho, texturas
node prep-model.mjs ../model/dragon/dragon.glb out.glb 0.2 0 0.5 0.02   # solda + decima (razão, yaw°, meia-altura, erro)
node optimize.mjs out.glb ../site/public/models/dragon-web.glb 2048 2048 1024   # WebP + Meshopt
```
Detalhes e orçamento de triângulos em [HANDOFF.md](HANDOFF.md).

## Atenção: licença do shader do céu
`site/src/toy/sky.glsl` vem do Shadertoy (`XsBXDc`). Autor e licença ainda **não foram confirmados**
(o Shadertoy usa CC BY-NC-SA 3.0 por padrão). Resolver antes de publicar ou submeter.
