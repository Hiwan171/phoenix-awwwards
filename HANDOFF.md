# HANDOFF — Phoenix (projeto Awwwards, meta: Honorable Mention)

Contexto completo para retomar em outra máquina / sessão. **Atualizado em 15/10/2026: a fênix v2 foi REMOVIDA** (leia a
primeira seção; o resto do arquivo é histórico da fênix antiga, útil como referência técnica).
Quem retoma (Claude ou humano): leia este arquivo, depois `DESIGN-BRIEF.md`.

## 15/10/2026 — virada: as feras seguem o estilo do dragão

**Decisão do usuário.** O dragão (`model/dragon/dragon.glb`: malha única de ~595k tris, BaseColor 4096² real, normal 4096²,
metal/rugosidade 2048², sem rig nem animação) ficou totalmente fora do estilo da fênix v2 (argila neutra pintada por código,
cascas de fogo, aura). Para o conjunto ler como UMA peça (e não pesar contra no júri do Awwwards), **todas as feras terão a
mesma textura/estilo do dragão**. A **cena inicial segue sendo uma fênix, mas uma NOVA** nesse estilo (já está em `model/Fenix/fenix.glb`: 594.901 tris,
BaseColor 4096², sem rig; bruta, ainda não otimizada); **o dragão entra em outra cena** (`model/dragon/dragon.glb`) e virão
outras feras. Ambas as pastas (~130 MB cada, com PNGs soltos duplicados) ainda NÃO estão commitadas: o GLB web de cada uma sai
em ~3 MB pela receita abaixo (testado no dragão: 595k → 119k tris, 2,9 MB); versionar só ele, não os brutos.
Por isso a fênix v2 e tudo que era específico dela saiu do repositório; ficou só o céu de fundo e o palco.

**O que saiu** (tudo recuperável: o último commit com a fênix é `0a0f28f` = `origin/v2`):
GLBs (`site/public/models/*`, `model/model.glb` + texturas, `assets/source/tripo*.glb`), plumagem procedural
(`plumage.js`, `phoenix-material.js`, `shaders.js`: cascas de fogo, cinza, brasa), `noise-tex.js`, o voo (`fly.html`,
`fly.js`, `wingflight.js`), o laboratório (`sky.html`, `sky-test.js`, `sky.js`), `fire-test.html`, `viewer.html` e as
ferramentas de rig (`build-rig*.mjs`, `skeleton*.mjs`, `anim.mjs`, `landmarks/centroids/tails/silhouette/kmeans/texprobe`,
`dump-skeleton`, `debug-skel`, `inspect-viewer/`, `make-phoenix.sh`) e, a pedido, toda a camada de UI do hero (loader "Gathering
ash", copy, HUD, nav, altímetro, vinheta, grão). Para trazer algo de volta:
`git show 0a0f28f:site/src/plumage.js > site/src/plumage.js` (ou `git checkout 0a0f28f -- <caminho>`).

**O que ficou** (genérico, serve às novas feras):
- `site/src/stage.js` — palco: renderer, céu (Shadertoy `XsBXDc`), rig de luz aprovado (`looks.js`), compositor, **governador de
  qualidade**, ganchos de QA (`S.t` congela o relógio; `?q=N` fixa um tier; `?gov=0|1`). `load()` não baixa nada hoje.
- `site/src/hero-post.js` — pós-processamento fundido (ver abaixo). `flame-aura.js` fornece o campo de chama da aura.
- `tools/`: `prep-model.mjs` (solda + decima um GLB bruto do gerador) e `optimize.mjs` (WebP + Meshopt) servem direto às
  novas feras; `inspect.mjs`, `verify.mjs`, `qa.mjs`, `live.mjs`, `render.mjs`/`project.mjs` também.
- Backup do trabalho de performance NÃO commitado (plumagem assada por vértice, cascas com LOD, pré-passe...):
  pasta `phoenix-awwwards.backup-20261015-103322` ao lado do projeto (pode apagar quando quiser).

**Estado do hero agora (15/10/2026, a pedido do usuário: "vamos criar esse mundo hero todo do zero"):** SÓ o shader do céu,
em tela cheia, rodando sozinho. **Sem transição de abertura, sem loader, sem texto, HUD, nav, altímetro, vinheta nem grão.**
O DOM é `<canvas id="gl">` + o script; `style.css` tem ~10 linhas; `main.js` só liga o palco e o ticker do GSAP; as fontes
(`@fontsource/*`) continuam no `package.json` mas não são mais importadas. 60 fps cravado nesta máquina (Intel UHD, 1080p),
sem avisos no console, ~1,1 MB de build. O HTML, o CSS e a copy antigos ("Everything burns.", atos, HUD) estão em git:
`git show 0a0f28f:site/index.html`, `git show 0a0f28f:site/src/style.css`.

### Hero com a fênix pairando (15/10/2026)
A página `/` agora mostra o céu + a **fênix centralizada, pairando e batendo as asas no lugar** (a pedido do usuário). Sem texto,
HUD nem aura (continua desligada). Peças: `site/src/hero-fenix.js` (carrega `fenix-{web,lite}.glb`, põe no palco, material com
ambiente próprio `ENV 0.5` e `METAL 0.6`), `site/src/beasts/fenix-hover.js` (o piloto do pairar) e `fenix.js` (o rig).
- **A batida** (1 Hz, com ±4 % de variação): descida = asas abrem e abrem em leque, corpo sobe, penas arrastam para cima;
  subida = asa flexiona (cotovelo fecha), leque fecha, corpo desce. Corpo balança e deriva devagar; cabeça fica estável contra o
  corpo (contra-rotação do pescoço + olhar lento); pontas das fitas da cauda seguem a aceleração do corpo; pernas pendem.
- A abertura é comandada pelo **ângulo do cotovelo** (não pela distância): pela distância o cotovelo estalava perto do braço
  esticado. `wingBalance` compensa a escultura assimétrica (asa direita mais baixa) para a batida ler simétrica.
- Medido no navegador: 60 fps travados (mediana 16,7 ms, p99 17,0 ms) nesta máquina com o céu e o bloom; ≤ 5°/quadro nos ossos
  das asas; sem NaN. Ajustes por URL: `?fenix=0` (só o céu), `?m=lite`, `?camR= &camX= &camY=`, `?metal= &env=`, QA com
  relógio congelado `__phoenix.S.t = segundos` (a batida é função pura do relógio).
- **Inspeção (para gravar vídeo e analisar o movimento):** `site/src/hero-inspect.js`, sem nenhum texto na tela. Arrastar = girar e
  inclinar a fênix · roda/pinça = zoom · duplo clique ou R = reiniciar a vista · setas = girar em passos · `1` `2` `3` = batida a
  25 % / 50 % / 100 % · Espaço = pausa (continua dá para girar) · `B` = mostrar o esqueleto. Também `?speed=0.25`.
- Enquadramento: `S = { camX: 0, camR: 3.1, camY: 0.12 }` em `main.js` (o padrão do palco deixava espaço para texto à direita).

### Para trazer uma fera nova (receita)
1. GLB do gerador (malha única ~600k tris, PBR 4096², sem rig). `node tools/inspect.mjs <glb>` mostra a estrutura.
2. `node tools/prep-model.mjs in.glb out.glb <razão> <yaw°> <meia-altura> <erro>`: assa o transform, centra/escala, solda por
   posição+UV (os normais facetados impedem a decimação), decima (meshoptimizer) e recalcula normais. Atenção: o yaw padrão (180)
   e o eixo "ave olha −Z" foram feitos para a fênix; ajuste por fera.
3. `node tools/optimize.mjs out.glb site/public/models/<nome>-web.glb 2048 2048 1024`: WebP + Meshopt (alvo ≲ 3–4 MB).
   (`node tools/make-creature.mjs <fera>` faz 2 e 3 para web e lite — e o rig, se existir `tools/rigs/<fera>.mjs`.)
4. No palco: GLTFLoader + MeshoptDecoder, `stage.scene.add(...)`. **Use as texturas do próprio GLB** (MeshStandardMaterial
   como veio; nada de pintura procedural). Para a aura de chamas: `mesh.layers.enable(1)` e `stage.post.aura.enabled = true`.
5. Orçamento (ver abaixo): 179k tris skinados custavam ~4 ms de geometria numa UHD 620; mire ≲ 100–120k tris na web e ≲ 40k
   na lite.

### Rigs das feras (15/10/2026) — uma fera por vez
O usuário quer as 4 feras com movimento fluido e real, e conduz o trabalho **uma fera por vez**: cada uma tem um briefing
escrito por ele (`model/<fera>/rig-<fera>.md`); terminada uma, avisa-se e ele passa o da próxima. **Não comece a próxima
sozinho.** Estado: **dragão e fênix prontos**; tigre e tartaruga aguardam. Tudo está documentado em `tools/rigs/README.md`.
- **Pipeline:** `node tools/make-creature.mjs <fera>` = prep → `tools/rigs/<fera>.mjs` (esqueleto + pesos → GLB skinado) →
  optimize → `site/public/models/<fera>-{web,lite}.glb`. O controlador de movimento vive em `site/src/beasts/<fera>.js`
  (`rigkit.js` tem o que é comum: `SplineIK`, `Strand` Verlet, IK de 2 ossos macio).
- **Dragão:** esqueleto de ~200 juntas (espinha de 52 com pesos B-spline cúbicos, patas, bigodes, 28 mechas de crina),
  Spline IK por 12 handles, limite de curvatura por junta, patas passivas/orbe. Laboratório ao vivo:
  `http://localhost:5173/dragon-lab.html` (só dev). 0 erros no validador glTF; ~0,3 ms de CPU por quadro (uma única atualização de matrizes por quadro, sem alocações).
- **Lições que valem para as próximas feras:** (1) o eixo do corpo vem do EIXO MEDIAL do volume (voxelização + campo de
  distância + caminho de custo mínimo), não de bandas na superfície (o caminho mais curto abraça o dorso); (2) cabelo/franja
  longe do eixo precisa de peso RÍGIDO do ponto de fixação, senão a mistura de ossos vizinhos o estica em curvas fortes; agrupe
  mechas por **componente conectado**, não por faixas ao longo do corpo; (3) todo IK precisa de "soft" perto do alcance máximo
  e todo osso de um limitador de velocidade angular; (4) `Float32Array` na Dijkstra gera re-empilhamento infinito: use float64;
  (5) com ossos de rotação de repouso identidade o controlador trabalha no espaço do modelo e "guia = repouso" reproduz
  exatamente a pose esculpida (teste de regressão barato).
- **Fênix:** braço = eixo medial da borda de ataque; *colunas de penas* penduradas no braço giram em leque (mais longe do
  ombro, mais ângulo); pescoço com gradiente longo; 5 fitas de cauda com `SplineIK` de 2 controladores; fios da crista em
  Verlet. Laboratório `http://localhost:5173/fenix-lab.html`. **Dobra total não suportada** (a escultura é asa aberta):
  `open` fica em 0,35–1,3. Detalhes e limites em `tools/rigs/README.md`.
- Ferramentas de rig: `tools/rigs/lib/{mesh,volume,skin,strands,gltfskin}.mjs` (reuso nas outras feras),
  `weights-debug.mjs`, `thin-debug.mjs`, `color-debug.mjs` (pinta vértices por uma expressão de x,y,z).

- **Fogo da fênix (15/10/2026)** — shaders que escondem o que o rig não resolve (bordas esfarrapadas, buracos dos cortes):
  1. aura de chamas da silhueta (`hero-post.js`) ligada na fênix (`layers.enable(1)` + `stage.post.aura.enabled`);
  2. o fogo segue a batida (`hero-fenix.js`: `power` = função da fase; `stage.fireGain` multiplica a intensidade e
     `uHeight` varia — flameja na descida, assenta na subida);
  3. brasa nas pontas das penas (`beasts/fenix-fire.js`): atributo `aTip` por vértice (0..1 ao longo de pena/fita/fio,
     lido dos pesos de pele), dissolve por ruído 3D da posição de repouso + borda incandescente no emissivo; a máscara da
     aura usa o mesmo descarte (`post.setMaskMaterial`), então as chamas acompanham o que sobrou.
  QA: `?fire=0` / `?aura=0` / `?burn=0.55`; `phoenix.fire.uDebug.value = 1` pinta `aTip`. Medido: 60 fps, p99 17 ms (web e lite).

- **Roteiro da história (15/10/2026): `ROTEIRO.md`.** Fênix visita Tartaruga (Norte, aquece o gelo) -> Tigre (Oeste, derrete o metal)
  -> Dragão (Leste, a alimenta até ela se consumir) -> cinza -> renascimento (só a fênix). 7 seções, ~700 vh, movimento
  preso ao scroll e reversível, som com interruptor. Ordem de construção e riscos (asa dobrada) estão lá.
- **Rigs do Meshy (15/10/2026):** os quatro GLBs rigados em `model/<fera>/<Fera>-RIG.glb` substituem os rigs de código.
  Ferramentas e testes em `tools/meshy-test/` (README); a fênix tem uma corrente por pena (`rig-feathers.mjs`), clipe
  `make-fenix-motion.mjs` e web GLB por `to-web.mjs` (`site/public/models/fenix-meshy-{web,lite}.glb`, 3,9 / 1,9 MB).
  No hero: padrão = rig Meshy, `?rig=old` = o anterior; fogo e aura **desligados** por padrão (`?fire=1`, `?aura=1`).

- **Laboratório de voo (16/10/2026): `http://localhost:5173/fenix-flight-lab.html`.** A fênix voa um caminho de demonstração
  num cenário vazio **comandada pelo scroll** (Lenis; rolar para trás desfaz o voo). Peças:
  `site/src/beasts/fenix-flight.js` (controlador: parâmetros -> poses dos 694 ossos, função pura, sem estado),
  `flight-path.js` (caminho Catmull-Rom por comprimento de arco + linha do tempo PCHIP monótona + câmera de perseguição),
  `flight-demo.js` (11 waypoints e 12 chaves: pairar -> subir -> voo batido -> planar -> mergulho -> arremetida -> aproximação
  -> flare -> pouso -> asas dobram) e `fenix-flight-lab.js` (a página). Modo "manual pose" tem sliders de todos os parâmetros e
  dos graus de liberdade da asa dobrada. Parâmetros (`P`): `t, phase, flap, open, sweep, legs, tail, bank, pitch, pitchRate,
  yawRate, lookYaw, lookPitch`. Fênix = f(progresso): nenhum estado entre quadros.
  Resultados: asa dobra de verdade (só o ombro desce+varre, `FOLD` em fenix-flight.js; dobra em Z grande empurra a ponta da asa
  para cima, então ficou leve); arestas esticadas ao longo do voo 0,02-0,23 % (pior na pose dobrada); sem saltos (<= 6,5 graus por
  passo de 0,0005 em u); 60 fps (web e lite); pose custa ~0,9 ms por quadro. QA: `__lab.setU(u)`, `__lab.setManual(P, cam)`.

- **Voo realista = corpo esticado (16/10/2026).** O primeiro teste voava "em pé" e rígido: o rig do Meshy carrega corpo, pescoço
  e cabeça com 9 ossos todos abaixo de y 1,15. Agora `tools/meshy-test/rig-spine.mjs` dá uma coluna de 11 juntas (pélvis -> cabeça)
  e `rig-feathers.mjs` ganhou a região "crista" (96 penachos/fios da cabeça). O controlador ganhou `P.fly` (0 em pé .. 1 postura de voo:
  corpo na horizontal, pescoço à frente, cabeça nivelada) e `P.stretch`; a linha do tempo da demo os dirige. O laboratório carrega
  `fenix-flight-{web,lite}.glb` (3,65 / 1,63 MB); o hero continua com `fenix-meshy-*.glb` e o clipe Hover até religarmos.

- **Teste da cena de abertura (19/10/2026): `http://localhost:5173/opening-lab.html`.** A fênix parada de asas fechadas num pico,
  agacha, pula, sobrevoa um vale e pousa numa saliência do outro lado, tudo pelo scroll (para trás desfaz). Cenário PROVISÓRIO
  (montanhas procedurais com alturas conhecidas em JS, céu de entardecer em shader, névoa, brasas no ar) só para julgar a
  coreografia e a câmera. `site/src/opening-lab.js`: caminho de 10 pontos, linha do tempo com canal `s` (posição no caminho, plana
  nas pontas = ela parada), pés plantados no terreno no pico e no pouso, orientação nivelada no chão, câmera cinematográfica keyed em u
  (no referencial de direção da ave, nunca dentro da montanha), sombra que segue a ave. 60 fps (web e lite). `?u=`, `?ui=0`,
  Espaço = auto-play, C = câmera livre, H = esconde a UI. QA: `__op.setU(u)`.

- **Visual de fogo da fênix (19/10/2026), na cena de abertura.** Antes: a cor crua do Meshy (tijolo empoeirado; luminância linear
  da textura: 5 % < 0,020, mediana 0,065). Agora, em camadas:
  - `site/src/beasts/fenix-look.js` (`applyFenixLook(mesh)`, encadeado com as pálpebras): a cor de base é **regradada pela própria
    luminância numa paleta de fogo** (preto-brasa → carmim → escarlate → laranja → ouro, pontas das penas mais quentes, pernas
    esverdeadas → bronze, olhos preservados); o albedo fica perto do brilho original (`albedo 0.5`) e **o brilho vem da emissão**:
    brasas só nas frestas mais escuras, faixas de calor correndo pelas cadeias de penas até a ponta (`aTip`), pontas quentes,
    rim de Fresnel, contraluz do sol atravessando as penas (só quando a câmera olha contra o sol) e olhos de brasa (fecham com
    o piscar). Opcional: dissolve das pontas (`burn`, desligado).
  - `site/src/beasts/fenix-embers.js`: faíscas que nascem nas pontas das penas (skinning na CPU só do vértice que renasce) e
    **ficam no ar onde ela passou**: em voo viram um rastro, pousada sobem dela. Relógio de parede (ela arde mesmo com o scroll parado).
  - Pós-processamento `hero-post.js` (bloom + aura de chamas da silhueta, ACES no passe final). O céu passa a ser escrito em luz
    linear. Novidades no `hero-post`: `params.samples` (MSAA da cena), `setSamples`, `setScale` (resolução dinâmica) e
    `params.occluders` + `LAYER_OCCLUDER` (o terreno entra só na profundidade da máscara, senão a aura desenha a cauda escondida
    atrás da montanha como um contorno pontilhado). `rim` da aura = 0 (em meia resolução ele pontilha os fios finos; o material
    já tem o seu rim).
  - Intensidade por cena (`HEAT`, keyed em u): **pousada ela só arde, pega fogo no salto**, chamas plenas em voo, um surto na
    freada, acalma no pouso. Cada batida para baixo aviva o fogo.
  - **Custo (Intel UHD, 1280×720, GPU ms por timer query, intercalado):** cru 6–11; visual completo sem MSAA 10–14; MSAA 2 ~17;
    MSAA 4 ~21 (MSAA num alvo HalfFloat é o vilão). Governador: começa em MSAA 4 e desce (4 → 2 → 0 → escala 0,85 → 0,72)
    enquanto >10 % dos quadros passam de 18 ms. Nesta máquina assenta em MSAA 0: 60 fps, 0 quadros perdidos, igual ao cru.
  - Flags: `?look=0` (cru, A/B), `?aura=0`, `?bloom=0`, `?msaa=N` (fixa, sem governador), `?scale=`, `?steps=`, `?embers=N`,
    `?bs=`/`?bt=` (força/limiar do bloom), `?sky=` (ganho do céu). QA: `__op.look.set({...})`, `__op.render(t)`, `__op.tier`.

- **Abertura: a fênix adormecida, de frente, e o vento (19/10/2026).** Novos parâmetros do controlador (`fenix-flight.js`):
  - `P.sleep`: o pescoço dobra em S (`SLEEP_THETA`: a base recua para os ombros, o meio vai à frente, a cabeça AFUNDA ~0,17 com
    40° de inclinação), sem olhar, crista deitada, respiração funda (`breathAt`). Curvar a cabeça além de ~50° põe a crista
    grande (parte rígida da malha da cabeça) em pé, como um moicano. Inclinar o pescoço para frente só leva a cabeça para frente,
    porque o pescoço é quase vertical em repouso.
  - `P.wind` + `windX/Y/Z` (no referencial do MODELO): rajadas (`gustAt`) que atravessam o corpo a favor do vento; cada cadeia
    (penas da cauda, crista, costas, raízes da cauda e, pouco, a asa dobrada) dobra na direção do vento e tremula, mais na ponta.
    Medido: variação das pontas da cauda 2,6 → 6,6 cm; arestas esticadas só +0,06 % (cauda). Pose com vento: 0,9 ms.
  - `P.shake` / `P.shakePh`: a sacudida de penas ao acordar (a fase vem do scroll, como a batida: não treme para sempre se o
    scroll parar ali). `P.hug`: asas coladas ao corpo (de frente a dobra normal as deixava abertas como braços).
  - No shader (`fenix-look.js`, antes do skinning): o peito infla com a respiração e as bordas das penas tremulam com o vento.
  - Cena: `LIFE` (sleep, eyes, shake, wind, hug) keyed em u. **Nada da fênix entra na montanha** (pedido do usuário: "100% de
    contato, limpo"): dormindo ela agacha de verdade (`P.crouch`, `CROUCH` = ângulos de quadril/joelho/tornozelo/pé/dedos que
    somam zero, então os dedos ficam planos onde estavam; o corpo desce 9 cm); o CONTATO é medido na MALHA dos pés (vértices
    skinned, não o osso: as garras passam dele) e encosta a 7 mm; a CAUDA é erguida (`P.tailLift`) o quanto precisa, resolvido
    uma vez no load para cada u (bisseção contra os vértices da cauda, margem 8 cm para o vento), e no ar o que faltar ergue o
    corpo; no salto a referência de altura é de onde ela salta (puxar para a rocha sob os pés arrastava a traseira para dentro do
    pico ao passar a borda). Coreografia mudada para isso: o salto sai para FRENTE e um pouco para baixo, corpo nivelado
    (`PATH[1]` y +0,3, `pitchBias` -0,15; antes subia empinada), freada 0,35 e toque 0,05 (antes 0,55 / 0,25: a cauda entrava na
    saliência). Varredura da cena inteira (u a cada 0,005, 4 instantes de vento, todos os vértices): ponto mais baixo +5 mm.
  - **Patas firmes no chão** (`P.ground`): pousada, as pernas não balançam (o balanço é das pernas penduradas em voo) e a BACIA
    (Spine_00, que carrega as pernas) não respira nem balança com o vento; a vida fica do peito para cima. Antes os pés derivavam
    até 7 cm em 8 s parados; agora 0,0 mm. Câmera de abertura mais aberta: 4,5 à frente, 0,5 abaixo, o pico inteiro, e um
    avanço até perto dela quando acorda. Câmera de frente, centralizada, levemente de cima
    (o vale escuro atrás dá contraste ao brilho), com push-in lento; ela acorda (olhos → cabeça → de pé → sacode → olha) e a
    câmera gira para o lado no agachamento.
  - **O relógio da VIDA (respiração, vento, olhar, piscar, tremulação) agora é o relógio real** (`lifeT`): na abertura ninguém
    rolou ainda, e com `u × SECONDS` ela ficaria congelada. A HISTÓRIA (pose, caminho, câmera) continua em u, reversível.
  - Vento visível: cinzas finas numa caixa que segue a ave (redondas; as coladas na lente são descartadas, senão viram um
    quadrado grande), as brasas do cenário derivam, as faíscas e as chamas da aura (`uLean` em `FLAME_FRAG`) se inclinam.
  - Flags: `?wind=0` (sem vento nas penas), `?roost=`, `?settle=`.

### Performance — o que medimos (Intel UHD 620 / i5-10210U, 1080p; vale para as novas feras)
- **Resultado:** o hero com a fênix foi de **19,5 → 38,8 fps** (A/B intercalado, vsync ligado) com visual equivalente
  (diff de pixels: corpo PSNR 61–71 dB; chamas estatisticamente iguais), e o governador leva a ~55–60 fps nos tiers altos.
- **Como medir direito:** (1) vsync LIGADO (rAF livre em headless dá rajadas e números falsos); (2) `EXT_disjoint_timer_query_webgl2`
  envolvendo cada `renderer.render` dá ms por passe; (3) carga externa (a IDE usa ~35% da GPU 3D!) varia o tempo em até ~2×:
  compare sempre A/B intercalado e mediana; (4) `readPixels` síncrono mede o custo total, mas superestima o fps real.
- **Armadilhas que custaram horas:** amostrar uma `DepthTexture` no ANGLE/D3D11 custou ~10 ms/quadro (use um RT de cor R32F);
  `texture(s, uv, -100.0)` gera aviso X4713 (use `textureLod`); o custo FIXO de geometria skinada é grande (~0,7 ms por passe
  de 130k vértices, 16 buscas de osso por vértice): cada passe extra de geometria pesa; passes full-res HDR custam ~0,9 ms cada.
- **Técnicas que valeram** (todas com prova por diff de pixels): paleta/cor por vértice em vez de por fragmento; não ler
  texturas que o shader sobrescreve; pré-passe de profundidade quando o fragment é pesado (−4,9 ms); corte antecipado EXATO
  (limitar o ruído por amplitude das oitavas); ruído 3D por textura 2D (1 busca/oitava, estatística idêntica); compositor
  fundido (cena full-res + aura/bloom em meia resolução + UM passe final); malha decimada 33% para efeitos limitados por triângulo.
- **Governador (`stage.js`, `TIERS`):** mede o intervalo real entre quadros; 2 janelas ruins de 0,5 s descem um tier, 10 boas
  sobem (com recuo exponencial). Tier 0 = o look aprovado; depois: céu a cada 2 quadros → passos da aura → resolução 0,9/0,8/0,7/0,6.



## Como rodar em outra máquina
```bash
git clone -b v2 https://github.com/Hiwan171/phoenix-awwwards && cd phoenix-awwwards
# (a branch v2 tem tudo de 14-15/10/2026; a main ainda é a 1ª fênix, de antes do v2)
cd site && npm install
npm run dev            # http://localhost:5173

# página:
#   /               hero: o céu do Shadertoy (a fênix v2 foi removida em 15/10/2026: ver a 1ª seção)
#   ?q=N            fixa o tier de qualidade (0..5);  ?gov=0 desliga o governador;  ?qa=1 = sem cobertura/HUD, tier fixo
```
Opcional (QA/ferramentas do GLB): `cd tools && npm install`. Os scripts de QA usam o Chrome
instalado em `C:/Program Files/Google/Chrome/Application/chrome.exe` (ajuste o caminho se for outro).

> A pasta `Awwwards-mcp/` (ferramenta de terceiros) e `node_modules/` NÃO vão no repositório.
> (Histórico: o `phoenix-rigged.glb` de 48 MB também não ia; as ferramentas de rig da fênix foram removidas em 15/10.)

---
# HISTÓRICO — a fênix v2 (removida em 15/10/2026)
Tudo abaixo descreve a fênix antiga e seus laboratórios. Os arquivos citados já não existem na árvore de trabalho:
recupere-os de `0a0f28f`. Fica como referência técnica das armadilhas e decisões.

## Fênix v2 (esculpida, 179k triângulos) — o modelo vigente a partir de 14/10
Fonte do usuário: `model/model.glb` (+ PNGs de textura PBR, **neutra/argila**: a cor será aplicada por código).
Rig, clips e GLBs web/lite saem de **um comando**: `cd tools && bash make-phoenix.sh [../model/model.glb]`
→ `site/public/models/phoenix-v2-web.glb` (3,0 MB, 179k tris) e `phoenix-v2-lite.glb` (1,4 MB, 60k tris).
Etapas (cada uma roda sozinha):
1. `prep-model.mjs`: assa o transform do nó (a malha vem com Z para cima), gira 180° (olha −Z), centra e escala
   para altura 1 (±0.5, que é o que os shaders do site assumem: `uYMin/uYMax`), solda por posição+UV e **descarta
   as normais** (malha facetada: sem isso o simplificador não colapsa nada), decima com meshoptimizer
   (`simplifyWithAttributes`) e recalcula normais suaves.
2. `build-rig-v2.mjs`: esqueleto `skeleton-v2.mjs` (67 juntas; **auto-escala** pelo tamanho da malha) + pesos de
   pele por distância a cápsulas + suavização no grafo + **remoção de rasgos** (simula o skinning nas poses de
   todos os clips e apaga triângulos que esticam >3x: pontes finas entre cabeça e asa viravam agulhas) e de
   ilhas flutuantes < 600 triângulos + os 4 clips (Flap/Hover/Glide/Idle, `anim.mjs` generalizado para N caudas).
3. `optimize.mjs`: WebP + Meshopt.
Esqueleto (medido da malha, ver `centroids/tails/landmarks/silhouette.mjs`): eixo do corpo em x≈−0.06 (ave
virada), asa esquerda (−X) varre bastante para trás (+Z), direita mais à frente (pose 3/4), cauda é um **leque
radial 3D de ~30 penas** (8 cadeias `Tail_A..H`), pernas `Leg_L/R`, crista só nos tufos da cabeça (`Crest1/2`).
**Não existe pluma longa da crista:** o fio fino visto de perfil é a pena líder da asa +X (um `Crest3` ali
rasgava a ponta da asa: já removido). Pontes de malha cabeça↔asa existem na escultura (por isso o corte).
Ferramentas de inspeção: `tools/inspect.mjs` (estrutura), `silhouette.mjs`/`centroids.mjs`/`tails.mjs`/
`landmarks.mjs` (coordenadas), `dump-skeleton.mjs` + `tools/inspect-viewer/shots.mjs` (renders: órbita, ortográfica
com grade, overlay de ossos `BONES=`, pesos coloridos `WEIGHTS=1`, clip congelado `p:Clip,t,...`).
No site: `sky.html?toy=1` carrega a v2 por padrão (`?model=phoenix-web.glb` = a antiga).

### Cor da v2 (plumagem procedural, LIGADA por padrão na v2; `?pl=0` = argila crua)
`site/src/plumage.js` (`bakePlumage`, **por nomes de osso**) + `PLUMAGE_GLSL` (`shaders.js`) + patch do material em
`sky-test.js`. Pinta por região anatômica + posição raiz→ponta (carmim → escarlate → laranja → âmbar → ouro), com
AO leve por cavidade da geometria, translucidez com o sol atrás (asa/cauda finas) e brasa sutil nas dobras.
A textura de argila só entra como luminância local (`?det=`, 0 por padrão: o atlas tem placas de brilho que
viram manchas). Botões: `?rough=` (0.78), `?glow=` (0.12), `?cav=` (1), `?trans=` (0.5), `?tau=` (0.04, largura da
mistura entre cadeias), `?lit=`, `?dbg=1..4` (cavidade / t / fino / convexo), `?fire=0` esconde as chamas.
As cascas de fogo ficam LIGADAS na v2 (chamas finas nas bordas; cor da raiz vem da paleta).
Armadilhas desta etapa (custaram caro):
- `t` por região DOMINANTE gera ilhas de borda dura (a dominância de peso é ruidosa): mistura contínua pelos pesos
  de região, equalizada por quantil por região, suavizada no grafo da malha.
- A escolha de cadeia por peso é frágil: soft-min por distância à polilinha, só entre cadeias da mesma região.
- **Quadro preto em 1898x942 (RESOLVIDO):** `pow(vQ.x, 1.5)` com vQ.x interpolado ligeiramente negativo = NaN,
  espalhado pelo bloom. Sempre `pow(max(x, 0.0), ...)` em varyings. Verificado em 7 resoluções.
- A cavidade por geometria continua em manchas grandes; fica só como AO sutil e brasa fraca.
### Paleta v2 baseada em referência real (14/10, depois da v1 toda vermelha)
O usuário passou uma referência (fênix realista): pontas das penas de voo em **carvão** (frio contra o fogo),
coberturas âmbar, peito dourado-creme, cabeça laranja-amarelo, bico escuro com cere amarelo, **olho dourado com
pupila preta**, **patas amarelas com garras escuras**, cauda dourada terminando em vermelho-marrom. Implementado em
`PLUMAGE_GLSL` (`plumage(w0,w1,q,x)`), com o atributo novo `aX = (outward, eyeD, cere)` do bake:
- `outward`: distância à cadeia de ossos da asa (calibrada pelo p95): as penas irradiam da cadeia, então
  "longe da cadeia" = ponta da pena = carvão (passando antes por vermelho-marrom, senão vira cáqui/oliva).
- **Olho (formato, 14/10, 3 iterações com o usuário):** 1) círculo = "esbugalhado"; 2) amêndoa com pupila =
  "largo demais e com uma bolinha"; 3) FINAL: **fenda amarela estreita, sem pupila, cunha inclinada** (referência:
  olho de fênix com pálpebra de cima reta, ponta atrás afiada, sombra suave sobre ela). Um círculo é o que sai de uma
  distância 3D ao centro; para uma forma mais fina que o espaçamento de vértices é preciso coordenada LOCAL por pixel:
  o bake grava `aE = (u, v)` (posição no referencial do olho mais próximo, eixo longo inclinado 28° com o canto da
  frente mais baixo, em unidades de meio-comprimento 0.0062 e meia-altura 0.0023; a versão 0.0098 "pegava a largura da cabeça"), linear na posição; o shader
  (`almondD`) desenha uma cunha: grossa na frente (u<0), ponta atrás, pálpebra de cima achatada (×0.42) e a de baixo
  curva, liner escuro fino e sombra de sobrancelha só logo acima do olho (NÃO uma placa: a 1ª tentativa de
  sobrancelha virou um retângulo escuro). `aX.y` só limita a vizinhança do olho (senão a mesma forma aparecia na
  testa entre os olhos, já que a projeção ignora profundidade). Ajustes: `eyeHalfLen/eyeHalfH/eyeTilt` em
  `bakePlumage` ou pela URL `?eyeL= ?eyeH= ?eyeT=`; cor/forma em `almondD`, `eyeIris` e no bloco `lid/brow` de `PLUMAGE_GLSL`.
- Olhos: **não existe olho esculpido** (só uma leve saliência sob a sobrancelha). Centros achados por raycast
  (`tools/inspect-viewer/pick.mjs`): `(-0.075, 0.25, -0.12)` e `(-0.035, 0.25, -0.12)`, raio `0.0075`, íris
  dourada + pupila + contorno escuro ("kohl") + emissivo leve (`?eye=`). Cere em `(-0.045, 0.242, -0.135)`, raio `0.02`.
- Patas: região `Leg_*` (coxa laranja → pé amarelo → garra carvão). `?dbg=5..9` mostra outward / eyeD / cere /
  peso cauda / peso perna.
- Translucidez: agora PROPORCIONAL à cor da pena (`albedo*2`); um laranja fixo lavava as pontas da cauda de bege.
- Fogo na v2: `uFire` 0.5 por padrão (`?fireI=`), as cascas ficam em estilhaços nas asas com valores altos.
- QA de câmera: `?camR=0.5&lx=-0.055&ly=0.255&lz=-0.1&camAz=0` = close na cabeça.
**ARMADILHA GRANDE (custou horas):** o GLB otimizado vem com posições `Int16Array` NORMALIZADAS (quantização do
Meshopt) e as inverse bind matrices ficam nesse mesmo espaço normalizado. Ler `geometry.attributes.position.array`
cru dá inteiros ±32767 e TODA distância/`t`/olho do bake fica sem sentido (parecia funcionar porque a ordem era
preservada). `plumage.js` agora decodifica por `getX/Y/Z` e ajusta uma afim por eixo entre as posições reais dos
ossos (grafo de nós) e as implícitas nas IBMs. Qualquer código novo que leia a geometria do GLB web deve fazer o mesmo.
### Aura de chamas (referência: finale do storytelling.noomoagency.com, 14/10)
`site/src/flame-aura.js` (`createFlameAura`), LIGADA por padrão no `sky.html?toy=1` (`?aura=0` desliga). Não é
geometria: é pós-processo em 3 estágios (máscara da silhueta em meia resolução → campo de chamas em meia
resolução → composição em resolução cheia com o contorno quente). Cada pixel desce pela máscara (as chamas
sobem, então a fonte está abaixo), por um caminho cisalhado por um campo de fluxo; a cobertura precisa vencer
um limiar de ruído em movimento, então quebra em línguas separadas que serpenteiam ao subir.
Botões: `?auraI=` intensidade, `?auraH=` altura (fração da tela, 0.36), `?auraW=` ondulação, `?auraRim=` contorno,
`?auraD=` densidade, `?auraN=` passos, `?auraDbg=1..4` (máscara/campo/cobertura/língua), `?skyDim=0.1` escurece o
céu para julgar (a referência é sobre fundo escuro; sobre o céu claro a soma aditiva lava).
Custo medido (sem vsync, RTX 3050): ~220 fps → ~175 fps em 1898x942. **A 1ª versão (1 passe em resolução cheia,
ruído por hash no laço) derrubava para ~25 fps**: 40 fbm por pixel. Otimização: ruído por TEXTURA 256² com o truque
smoothstep, campo de fluxo avaliado 1x por pixel, geração em meia resolução.
Armadilhas: (1) `pow(1-k, y)` com k um pouco > 1 (divisão na GPU) = NaN; `max()` engole o NaN e esconde o bug
no depurador (o campo `peak` parecia bom e `f` saía preto). (2) `ShaderPass` com objeto cru CLONA os uniforms e
a textura de um RenderTarget vira null: usar `ShaderMaterial`. (3) campo só em x dá PILARES retos; precisa
deformar o domínio do ruído com um fluxo que varia com altura e tempo. (4) `gl.finish()` não mede GPU no ANGLE;
medir fps real com rAF sem vsync. NÃO está no hero (`/`) ainda.
Pendente: integrar v2 + céu + aura ao hero (`/`, `stage.js` ainda carrega a antiga), lite para celular (rodar a
plumagem e a aura a 0.35 de escala), mais ouro nas coberturas/peito se quiser aproximar mais da referência.

## O hero atual (`/`) — céu + fênix v2 (14/10, depois do pedido "a paisagem faz parte do HERO")
**Decisão do usuário:** a paisagem (o céu do Shadertoy) faz parte do hero, e a transição de abertura (brasa →
cinza → dissolução) foi ELIMINADA para ser reformulada. A intro antiga está arquivada e funcionando em
`site/_archive/intro-ember/` (main.js, stage.js, index.html, style.css + README). Os shaders `ASH_*`/`EMBER_*`
continuam em `shaders.js`; o patch de revelação é `patchPhoenixMaterial(mat, U, { reveal: true })`.

O que `/` faz agora (`main.js` + `stage.js`):
- Cobertura opaca (void) com o contador "GATHERING ASH 0xx" enquanto carrega (copy ainda é da intro antiga: trocar
  só com ok do usuário), depois fade de 0.9 s. Sem sequência de abertura. `?qa=1` / `?intro=` / `?p=` = sem cobertura.
- **Céu**: `toy-sky.js` + `toy/sky.glsl`, look `golden` (`looks.js`: `LOOKS.golden` + `RIG_FORM`, fonte ÚNICA para
  hero e laboratório). O yaw do céu é um UNIFORM (`uYaw`; `CAM_YAW` definido como `uYaw`): `YAW_WIDE -0.54` (o
  aprovado: sol atrás do torso) em telas largas e `YAW_PORTRAIT -0.95` em retrato (em -0.13/-0.54 o sol caía atrás do
  texto/na borda e lavava o parágrafo); interpolado pela proporção.
- **Fênix v2**: plumagem + olho + cascas de fogo (`uFire 0.5`) + animação `Hover` (peso `S.hover`, 1) + olhar do
  pescoço seguindo o cursor. Luz = a do laboratório (chave frente-esquerda-acima 3.0, sol atrás só de contraluz,
  ambiente quase zero, exposição 0.92). Bloom só desktop, threshold 3.2 (só sol/fogo).
- **Aura de chamas** (só desktop): `AURA_I 0.6`, `AURA_RIM 0.8`, modo `opaque` (`uOpaque 1`: a chama COBRE o céu
  em vez de somar; somar laranja sobre céu dourado é invisível). É discreta sobre o céu claro: o pôr do sol já é
  o "fogo" da cena; ela brilha mesmo é sobre fundo escuro (modo aditivo, `auraOpaque 0`).
- **Legibilidade**: `.vignette` agora tem um scrim esquerdo (0.62→0) + escurecimento radial; `.display/.lede` com
  sombra suave; as barras do HUD são translúcidas (não mais void sólido).
- **Composição** (`stage.js`, sobrescrevíveis por `S` em `window.__phoenix.S`): `camR 2.8`, `camX 0.42`, `camLook 0.03`;
  retrato: +1.45 de distância e olhar 0.42 (fênix na metade de baixo). QA: `camR camX camLook camLookP camPushP
  auraI auraRim auraOpaque hover skyYaw`.
- **Medido** (RTX 3050, Edge, vsync): 144 fps de 1366x768 a 1920x1080, 105 fps em 2560x1300 (o céu em tela cheia
  é o custo; `scale` do céu 0.5, 0.4 no lite). Produção: 3,87 MB sem compressão, pronto aos ~2,4 s, sem erros.
- Lite/celular: composer sem bloom/aura, céu a 0.4, modelo `-lite`.
- Pendente: tablet em retrato tem a chama atrás do parágrafo (menor); `site/public/models/phoenix-web.glb` e
  `-lite.glb` (fênix ANTIGA) ainda vão no `dist` (+6 MB mortos); reformular a abertura.

## Voo (14/10): a fênix sobrevoando o cenário — `http://localhost:5173/fly.html`
Pedido: "sobrevoando o cenário com realismo e fluidez"; história escolhida pelo usuário: **cruzar a câmera → mergulho →
subida**; investir nas asas. É um LABORATÓRIO (ainda não está no hero nem nos atos).
`site/fly.html` + `site/src/fly.js` (controlador) + `site/src/wingflight.js` (asas), sobre o MESMO `createStage`
(o palco ganhou controle externo em `S`: `S.bird` posição/rotação do corpo, `S.pose(bones)` depois dos clips, `S.cam`,
`S.skyYaw/skyPitch`; `CAM_PITCH` novo em `toy/sky.glsl`).
- **Controles**: rolar = voar (a velocidade do scroll É a velocidade do voo; parou = paira); `Espaço` = voo automático
  (ida e volta). URL: `?auto=1&dur=` `?bank=` `?lay=` `?neck=` `?fmin= ?fmax=` `?flex=` `?amp=` `?twist=` `?stab=`
  `?depth=` (aproxima o caminho) `?cdist=` (distância da câmera). QA: `?u=0.3&v=1.8` (ponto + velocidade forçada),
  pinar modos `&G= &dive= &climb= &w= &e=`, `&view=side|front|top|q34|back&dist=`, `&ph=` (fase da batida).
- **A escultura está EM PÉ** (cabeça para cima, asas em V): voar na horizontal exige deitar o corpo e refazer as asas,
  então tudo é pilotado por código, não por clips.
- **História** (`POINTS` em fly.js, 16 pontos, `depth 0.72`): I vem do fundo, CRUZA a lente a ~2.5 de distância e sai;
  II sobe em arco sobre o sol, vira e MERGULHA; III arremete rente à água e SOBE. Modos vêm da FORMA do caminho
  (inclinação `f.y`) e da velocidade, não de gatilhos: `dive`, `climb`, `G` (planeio), `w` (deitada), `e` (esforço).
- **Asas** (`wingflight.js`): a asa é definida por PARA ONDE CADA SEGMENTO APONTA no referencial do corpo (+y = cabeça,
  +z = dorso, lateral = −x em L), não por ângulos de dobradiça. Por segmento: elevação (cima/baixo, a ponta viaja mais),
  varrida para trás, FLEXÃO de cotovelo+pulso na subida (a asa dobra em Z), atraso de fase distal (a ponta se arrasta),
  torção (pronação/supinação, mais nas primárias). Misturas por direção (slerp): pairar (V esculpido batendo em torno do
  peito) ↔ cruzeiro ↔ planeio ↔ stoop (asas recolhidas para trás no mergulho). Assimetria na curva: a asa de dentro
  (a mais baixa no mundo) bate menos e flexiona mais, a de fora mais. Pescoço compensa 100° para a cabeça olhar à frente
  e contra-rola 50% contra o rolamento do corpo.
- **ARMADILHA (custou uma rodada)**: rotação mínima entre vetores OPOSTOS é indefinida. A ponta flexionada (apontando
  trás/baixo) é quase exatamente oposta à direção de repouso (frente/cima): a pena virava 76° em 0,005 de ciclo (170°
  por quadro no teste real). Correção: passar por uma direção canônica LATERAL (repouso → lateral fixo → alvo); em
  D == repouso o produto é a identidade, então a pose esculpida se preserva. Detectado só medindo a velocidade angular
  dos ossos por quadro (`smooth.mjs`); a olho nu em quadros congelados não aparecia.
- **Câmera**: de perseguição com atraso (dolly com piso z = −2.6, então o cruzamento passa perto da lente), mantém a
  fênix a ~4.2 (~40% da altura). O céu é um shader de tela cheia SEM profundidade: a viagem é dada por pan (`uYaw`) e
  inclinação (`uPitch`) seguindo a câmera. Sem paralaxe real de nuvens/montanhas.
- **Medido** (RTX 3050): 144 fps, p99 7,1 ms, pior quadro 7,2 ms (1898x942) e 13,9 ms (2560x1300), 0 quadros > 20 ms;
  corpo ≤ 1,4°/quadro, asas ≤ 4,2°/quadro (p99 2,7°), cabeça ≤ 0,8°/quadro; sem erros.
- **Limites conhecidos**: as primárias não têm osso individual (a pluma é pele de 2 ossos, `Tip1/Tip2`): só dá para
  abri-las um pouco com torção diferente; cauda e pernas ainda só ondulam (não abrem/fecham com subida/mergulho);
  luz de contraluz fixa no mundo enquanto o sol do céu gira com a câmera (diferença pequena, mas existe); sem
  mergulho de verdade na água (o mar é só o fundo do shader); caminho de 16 pontos feito à mão.
- **Para o site**: ligar este mesmo `fly.js` ao ScrollTrigger/Lenis dos atos, com um caminho por ato.

## Estado
| Peça | Onde | Estado |
|---|---|---|
| Fênix rigada (52 ossos, clips Flap/Hover/Glide/Idle) | `site/public/models/phoenix-web.glb` (3,3 MB), `phoenix-lite.glb` (2,8 MB). Fonte do rig: original Tripo em `assets/source/` (o `phoenix-rigged.glb` de 48 MB é regenerável) | **pronta** |
| Fogo em GLSL (aprovado) | `site/src/shaders.js` (`SHELL_*`), preset: só chamas, fogo 1.5, comprimento 0.05, bloom 0.46, 3 camadas. Teste isolado: `fire-test.html` na raiz | **pronto** |
| Hero (só o hero, por decisão do usuário) | `site/index.html`, `src/main.js`, `src/stage.js` | funcionando com a **fênix v2 + aura** (seção acima); transição A implementada |
| Transição inicial "A — a brasa é a semente" | `main.js` (boot), `stage.js` (`createStage` síncrono + `load()`), `shaders.js` (`uBirth`, `EMBER_*`) | **implementada, aguardando aprovação visual do usuário** |
| Céu procedural meu | `site/src/sky.js`, `sky-test.js` | funcional, **não escolhido** |
| Céu Shadertoy XsBXDc | `site/src/toy/sky.glsl` + `src/toy-sky.js` | **escolhido**, entardecer laranja |
| Seções/scroll antigos | `site/_archive/scroll-slice/` | arquivado (não usar sem pedir) |

## Decisões do usuário (não reverter sem perguntar)
1. **Fogo = extensão do GLB, nunca cobre a textura.** Chamas só saem de pele voltada para cima e da silhueta.
2. **Escopo atual: só o hero**, e o hero = **céu do Shadertoy + fênix v2** (a paisagem é parte dele, 14/10).
3. **A transição de abertura foi ELIMINADA para ser reformulada** (14/10). A direção "A — a brasa é a semente"
   (cinza que nasce com o carregamento, ≤ ~4 s, com pular) foi aprovada e implementada, mas está arquivada em
   `_archive/intro-ember/`. Não recolocar sem pedir: o usuário quer redesenhá-la com o céu como cenário.
4. **Scrollytelling futuro:** a fênix sobe/voa por cenários com o scroll (céu realista).
5. **Céu: laranja de entardecer realista.** Sem roxo, sem vermelho (ambos rejeitados). Nuvens lentas.
6. Não fazer por iniciativa: trocar textos, travar scroll, adicionar efeitos. **Perguntar antes.**
7. Idioma da conversa: PT-BR. Site: EN.

## Parâmetros afinados (pelo usuário)
- Céu Shadertoy (`sky.glsl`): `SUN_T 14.6`, `CAM_YAW -0.54` (sol atrás do torso), `CLOUD_SPEED 0.30`,
  `SKY_EXPOSURE 0.92`, `SEA_DARK 0.42`, `WATER_RIPPLE 1.0`, `SUN_REFLECTION 0.0`.
- Composição: vinheta `uVig 0.55` em `toy-sky.js`; rim light dourado `?rim=` em `sky-test.js` (agora vem do look).
- **Looks de cor (`sky-test.js`, tabela `LOOKS`, `?look=`)**: separam a cor do céu da luz da fênix. Padrão no modo
  toy = `golden` (laranja só perto do sol, ardósia no alto, mar neutro escuro; fênix com luz branco-quente neutra
  em vez de laranja). Outros: `now` (o anterior), `dusk` (mais escuro/dramático), `soft`, `teal` (mais azul),
  `dusty`, `smoke` (os dois últimos lavados demais). `?sat=` ajusta a saturação final do céu.
  Os tints do céu viraram macros em `sky.glsl` (`SKY_HORIZON_TINT`, `SKY_TOP_TINT`, `SEA_TINT`...), injetáveis
  por `createToySky({ defines })`. Cuidado: o tint passa por `pow(.,2.6)` + tonemap, então é muito amplificado.
  O rig de luz da fênix só vale no modo toy; o hero (`stage.js`) ainda não usa céu.
- **Luz da fênix (`RIG_FORM`)**: luz principal neutra-quente lateral-frontal-alta (`fillPos [-2.6,1.6,-1.2]`,
  2.3), ambiente/env quase zerados, sol atrás só de contraluz. `?lit=1.3` clareia, `?lit=0.8` escurece.
  Antes, um fill frontal + hemisfério + env enchiam o corpo por igual: vermelho chapado, "manta laranja".
  Isolado por A/B (fogo, bloom e rim NÃO eram a causa; o "só PBR" já era chapado).
- **Grade do albedo (`GRADE_GLSL` em `shaders.js`, `phxGrade`)**: a textura crua é uma chama auto-luminosa
  (média `#e6580a`, sat 0.96, valor 0.85-0.94, matiz só 0-45°, sem ouro). No sky-test fica LIGADO por padrão
  (`?pg=0` = textura original): matiz −4° só nos laranjas, vermelhos ×0.85 de valor, sat ×0.88, âmbar intacto,
  `lit` 1.2. Ajustes: `?pgHue= ?pgSat= ?pgVal= ?pgAmber=`. Vale também para o fogo (cor graduada, brilho e
  FORMA da chama vêm da textura original). O hero (`stage.js`) NÃO usa o grade (`uGradeOn` 0).
  Armadilhas: (1) `pow(hsv2rgb(..), 2.2)` com saída 1 ulp negativa = NaN = tela inteira preta via bloom, só em
  resoluções maiores, então clampar antes do pow. (2) deslocar o matiz dos vermelhos (<8°) para negativo os
  torna magenta/rosa: vermelhos ficam travados. (3) a casca de fogo usa a luminância do albedo para decidir
  onde há chama: nunca passar o albedo graduado ali, senão o fogo some.
  O dourado que se via antes era FOGO aditivo + bloom sobre laranja saturado, não albedo: com o grade a fênix
  fica vermelha com chamas, sem gradiente ouro no corpo. Se quiser ouro de volta, subir `uValAmber`/chama.
- **Plumagem procedural (EXPERIMENTAL, opt-in `?pl=1`)**: `src/plumage.js` (`bakePlumage`) + `PLUMAGE_GLSL`.
  Pinta por região anatômica + posição raiz→ponta (paleta carmim→escarlate→laranja→âmbar→ouro), textura só
  como quebra sutil, translucidez com o sol atrás, AO leve. Resultado: gradiente bonito, mas **em 1898x942 o
  quadro central sai 100% preto com `?pl=1`** (reproduzido 2x; 1600x900/1280x720/1920x1080 ok): causa NÃO
  achada (suspeita: valor não-finito + bloom, dependente de resolução; ver armadilha do NaN acima). Por isso
  está desligado por padrão. Limites: índices de osso do `plumage.js` são fixos para ESTE rig; a malha do
  Tripo não tem frestas de pena reais (a cavidade por geometria dá manchas, então virou AO sutil); o `t` das
  penas precisou de equalização por quantil (as penas passam do fim da cadeia de ossos).
  **Decisão do usuário (14/10): o GLB é bom de cor e fraco de detalhe; ele vai gerar OUTRA fênix focada em
  detalhe, e a cor será aplicada por código.** Então: o grade/plumagem são o caminho para colorir o modelo novo
  (trocar `boneInfo`/`CHAINS` pelo rig novo), não vale polir mais o modelo atual.
- Câmera do hero: `S.camR 2.5`, enquadramento deslocado à direita em telas largas.

## Pendências (ordem sugerida)
1. **Licença/autor do shader XsBXDc.** Shadertoy usa CC BY-NC-SA 3.0 por padrão. Antes de submeter:
   conferir no Shadertoy e dar crédito (no código e/ou rodapé). Se for NC e o site tiver caráter comercial,
   usar o céu procedural (`sky.js`) em vez dele.
2. ~~Performance.~~ Resolvida nesta máquina: 144 fps no hero e no laboratório (os 27–28 fps eram da máquina antiga).
3. ~~Integrar o céu ao hero.~~ **Feito** (14/10, ver "O hero atual").
4. **Atos II–V**: partir do teste de voo (`fly.html`). **Reformular a transição de abertura** (decisão do usuário, ainda sem briefing). Ela precisa nascer para o céu
   como cenário (não mais fundo preto). A antiga está em `_archive/intro-ember/` como referência técnica.
5. Depois: Atos II–V (ver `DESIGN-BRIEF.md`), textos finais (os atuais são rascunho), tipografia, mobile,
   reduced-motion e fallback sem WebGL (código existe, NÃO foi testado), medição Lighthouse.

## Armadilhas já encontradas (economize tempo)
- `skeleton.boneMatrices` é realocado pelo three após o 1º render: nunca use `.length` como stride.
- Um único pixel NaN/Inf no céu HDR apaga a tela inteira via UnrealBloomPass: sanitizar a saída do shader.
- Textura de ruído do Shadertoy: `G(uv) = R(uv − (37,17))`. Sinal trocado = nuvens quadriculadas.
- GSAP `lagSmoothing(0)`: a intro é por relógio de parede.
- O Shadertoy bloqueia navegador automatizado (Cloudflare): o código do shader veio colado pelo usuário.
- Vermelho vs. vermelho: o problema de contraste da fênix é de **luminosidade**, não de matiz.
  Causa real (14/10): luzes da fênix seguiam a cor laranja do céu (`st.eye`/`st.amb`+`dawn`), e o ACES empurra
  vermelho muito exposto para laranja. Luz neutra-quente + exposição menor mantém o carmim/ouro do modelo.
- `aRand.z` é também a coordenada Z da cinza: nunca usar como seletor (as "brasas grandes" caíam todas num plano).
  O seletor agora é um hash independente de `aRand.xy`.
- `window.__phoenix.ready` só vira `true` no handoff (fim do carregamento), não no frame 1.
- Máquina nova (Windows): sem Chrome em `Program Files`; o Edge em `C:/Program Files (x86)/Microsoft/Edge/
  Application/msedge.exe` funciona com Playwright (`--use-angle=d3d11` usa a GPU real).

## Ferramentas (pasta `tools/`)
`build-rig.mjs` (esqueleto + pesos + clips), `optimize.mjs` (WebP + Meshopt), `verify.mjs`, `qa.mjs`
(captura com tempo congelado: `PAGE=sky.html EXTRA="&toy=1&t=8" node qa.mjs prefixo 1280 720 x`),
`live.mjs` (execução em tempo real), `render.mjs`/`project.mjs` (previews em CPU).
