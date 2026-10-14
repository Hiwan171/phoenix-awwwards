# DESIGN BRIEF — Phoenix: *A Cycle in Five Acts* (título de trabalho)

> Objetivo: Honorable Mention no Awwwards. Peça de showcase, sem cliente.
> Estado: **proposta v1 para aprovação**. Tudo marcado `[REF]` vem de evidência das referências;
> tudo marcado `[PROPOSTA]` é decisão criativa minha, ainda sem prova externa.

---

## 1. Ideia central (a "uma ideia só")

**A fênix é feita de cinza, e a página é a altitude dela.**

Duas ideias amarradas, nada além disso:

1. **Cinza → carne → céu.** A fênix nasce de partículas amostradas da superfície do próprio modelo
   (o loader *é* a abertura: as brasas se juntam enquanto o site carrega). Quando acende, vira malha.
   No final, desmancha de novo em cinza. O ciclo fecha.
2. **Altitude como interface.** O scroll é altitude (0 m → 3.000 m). Um medidor vertical fino é, ao mesmo
   tempo, barra de progresso, navegação por capítulo e assinatura visual. A temperatura da luz
   acompanha a altitude.

**Por que isso pontua:** Criatividade (20%) fica com a materialização/desmaterialização guiada pelo
carregamento, e Usabilidade (30%) fica com um indicador que *explica* o scroll em vez de decorar.

---

## 2. Calibragem com o júri

| Critério | Peso | Como o projeto responde |
|---|---|---|
| Design | 40% | Direção de arte contida: preto quente + um acento de fogo, tipografia editorial enorme, muito vazio |
| Usabilidade | 30% | 60 fps, loader que é conteúdo, índice de capítulos, teclado, reduced-motion, mobile desenhado |
| Criatividade | 20% | Cinza amostrada da malha + altitude-como-UI + fênix reagindo ao cursor via rig |
| Conteúdo | 10% | Texto curto e real (mito em 5 culturas), sem lorem, sem marca falsa |

`[REF]` O Dragonfly Redux (SOTD, 22/07/2026) tirou **Design 7,55 · Usabilidade 7,29 · Criatividade 7,49 ·
Conteúdo 6,84**. Mesmo um SOTD é fraco em Conteúdo, que é onde dá para se diferenciar barato.

---

## 3. Evidência das referências

| Referência | O que levamos | O que NÃO levamos |
|---|---|---|
| **dragonfly-redux** (SOTD) | Criatura como herói em preto + laranja `#FA4C14`; tipografia gigante central; moldura com letras nos cantos; hover ASCII; Lenis + Three; easing `cubic-bezier(0.445,0.05,0.55,0.95)` a 350 ms para micro-UI | A estética corporativa/cripto e o hover ASCII (é a assinatura deles) |
| **g-colombel-portfolio-2026** (nominee) | Atmosfera de brasa: névoa marrom-avermelhada, objeto emissivo único, reflexo no chão, luz como protagonista | O ambiente de "paisagem" |
| **chladni** (nominee) | Contenção: serifa de display elegante + microrrótulos mono + preto absoluto + um único objeto | O layout de tela dividida |
| **ten-pound-feather** (nominee) | Textura de gravura/hachura sobre fundo escuro, ar de "enciclopédia antiga" para o conteúdo do mito | A sobrecarga de elementos |

**Limite honesto:** o corpus só devolveu Motion DNA útil de 2 sites, e nenhum tinha scrub/pin medido.
Logo **a coreografia de scroll é proposta minha**, não extraída. O passo 3 (cenas) deve incluir gravar o
movimento de dragonfly-redux e g-colombel para estudo quadro a quadro.

---

## 4. Sistema visual `[PROPOSTA]`

### Cor (calor sobe com a altitude)
| Token | Hex | Uso |
|---|---|---|
| `--void` | `#070504` | fundo base (preto quente, não `#000` puro) |
| `--ash` | `#1B1714` | superfícies, cinza das partículas |
| `--bone` | `#EEE7DB` | texto principal |
| `--ember` | `#FA4C14` | acento `[REF dragonfly]`, no máx. ~10% de qualquer quadro |
| `--flame` | `#E8321A` | vermelho da plumagem (vem do modelo) |
| `--gold` | `#F2A93B` | pontas das penas, clímax |
| `--hot` | `#FFF1D0` | branco-quente, só no pico de brilho |
| `--dawn` | `#2A1D1A → #6B3A2A` | gradiente do Ato IV (amanhecer dessaturado) |

Regra: **a fênix é a única fonte grande de cor.** UI e texto ficam em `bone` sobre `void`.

### Tipografia
- **Display:** *Instrument Serif* (e itálico para ênfase). Tamanhos de 12–20 vw nos títulos de ato.
- **Utilitária:** *Geist Mono* em caixa-alta, 11–12 px, espaçamento aberto (altitude, rótulos, índice).
- **Corpo:** *Inter* 16–18 px, largura máx. 52 ch.
- Todas são OFL (licença livre), com `font-display: swap` + preload.

### Layout e moldura
- Grade de 12 colunas; título de ato ocupa 8–10 col., corpo em 4 col. deslocado.
- **Moldura de cantos:** letras/rótulos nos 4 cantos `[REF dragonfly]` — aqui carregam *ATO · ALTITUDE · TEMPO · SOM*.
- **Medidor de altitude** fixo na borda direita: régua vertical com marcas a cada 100 m, número em mono.

---

## 5. Movimento `[PROPOSTA, com 2 âncoras de REF]`

- **Scroll:** Lenis `[REF]`, lerp ~0.09. GSAP ScrollTrigger com `scrub: 0.6` nos atos.
- **Easing de UI:** `cubic-bezier(0.445, 0.05, 0.55, 0.95)` a 350 ms `[REF]`.
- **Easing narrativo:** `power3.inOut` (transições de ato 900–1400 ms) e `expo.out` (revelações de texto 700 ms).
- **Fênix:** `timeScale` do clip acompanha a velocidade do scroll; crossfade de 350 ms entre clips.
- **Cursor:** cabeça (`Head`/`Neck*`) faz look-at suave com amortecimento; calor local empurra as brasas.
- **Orçamento:** nenhuma animação decorativa sem função narrativa. Máx. 3 efeitos ativos por quadro.

---

## 6. Os cinco atos

Cada ato ≈ 100 vh de scroll "pinado" (total ~700 vh). Fênix = `phoenix-web.glb`.

| Ato | Altitude | Clip / estado da fênix | Visual | Texto (EN) |
|---|---|---|---|---|
| **I · CINDER** | 0 m | Só partículas (≈40k) amostradas da malha, em repouso. O loader é este ato. | Preto quente, cinza flutuando, 1 brasa no centro | *"Everything burns."* |
| **II · SPARK** | 0 → 400 m | Partículas convergem e viram malha. Ignição **de baixo para cima** (gradiente emissivo em Y). Clip `Idle`. | Calor sobe pela plumagem; primeiro bloom | *"It starts as a spark."* |
| **III · FLAME** | 400 → 1.400 m | `Hover` → `Flap`. Câmera orbita ~60° até 3/4 de rosto. Brasas saem das pontas das asas (ossos `Wing_*_Tip2`). | Vermelho/ouro cheio, bloom seletivo, névoa quente | *"Fire is not the end."* + faixa **Five names** (ver §7) |
| **IV · ASCENT** | 1.400 → 3.000 m | `Flap` → `Glide`. Câmera sobe na vertical. Fundo vira amanhecer dessaturado. | `void` → `dawn`, raios de luz finos, partículas quase paradas | *"Rise."* |
| **V · RETURN** | 3.000 m | `Glide` → desmancha em cinza que cai. Uma brasa fica. | Volta ao `void`. Rodapé: créditos + botão **Begin again ↺** | *"And begins again."* |

Detalhe de fechamento: **Begin again** rola de volta ao topo e a cinza se re-materializa, fechando o ciclo.

---

## 7. Conteúdo `[PROPOSTA — fatos a revisar na hora de escrever]`

Faixa **Five names** (Ato III), um nome por vez em tipografia grande, trocando com o bater de asa:

| Nome | Tradição | Nota curta |
|---|---|---|
| **Bennu** | Egito | ave solar de Heliópolis, ligada à criação |
| **Phoenix** | Grécia | ciclo de longa duração, renasce das cinzas |
| **Fenghuang** | China | harmonia e virtude, sem morte em fogo |
| **Zhar-ptitsa** | Rússia | a ave de fogo dos contos |
| **Simurgh** | Pérsia | ave imensa que reúne os pássaros |

Regra de texto: frases de ≤ 12 palavras, uma ideia por tela. Revisar cada fato antes de publicar.

---

## 8. Usabilidade, acessibilidade e performance (não negociáveis)

- **Orçamento:** primeira carga ≤ ~5 MB (JS + GLB), 60 fps em notebook intermediário, DPR limitado a 1,75.
- **Mobile:** `phoenix-lite.glb`, 12k partículas, composição vertical (o modelo é alto, então encaixa em retrato).
  Layout próprio, não encolhido.
- **Sem WebGL / reduced-motion:** atos viram seções estáticas com poster da fênix e fades curtos;
  todo o texto é HTML real, legível sem canvas.
- **Teclado:** índice de atos focável (I–V), setas/Page navegam entre atos, foco visível.
- **Som:** desligado por padrão, toggle no canto. Só se sobrar tempo.
- **Medição:** Lighthouse desktop ≥ 85, CLS ≈ 0, teste real em celular antes de submeter.

---

## 9. Plano técnico `[PROPOSTA]`

| Peça | Escolha | Observação |
|---|---|---|
| Build | Vite | |
| 3D | Three.js | `GLTFLoader` + `MeshoptDecoder` + `AnimationMixer` |
| Scroll | Lenis + GSAP ScrollTrigger | |
| Partículas | `THREE.Points` + shader próprio | amostradas com `MeshSurfaceSampler` |
| Fogo | `onBeforeCompile` no material PBR | máscara emissiva por luminância + ruído + altura (`uIgnite`) |
| Pós | bloom seletivo (UnrealBloom/pmndrs) | só nas regiões emissivas |
| Rig | ossos do GLB | `Head`/`Neck*` (cursor), `Wing_*_Tip2` (emissores), `Tail_*` (balanço) |

**Stretch (se o orçamento permitir):** partículas também deformadas pelo esqueleto (skinning de pontos
em shader), para a cinza "voar" junto com a fênix.

---

## 10. Decisões em aberto (para você)

1. **Nome/título** do site (hoje: *Phoenix — A Cycle in Five Acts*).
2. **Som:** entra ou fica de fora?
3. **Faixa "Five names":** manter (ganha Conteúdo) ou cortar (mais enxuto)?
4. **Ato IV claro:** amanhecer dessaturado, ou manter 100% escuro?
5. **Stretch de partículas esqueléticas:** tentamos ou garantimos o resto antes?
