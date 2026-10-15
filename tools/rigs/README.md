# Rigs das feras

Cada fera tem (1) um **construtor** aqui (`tools/rigs/<nome>.mjs`: esqueleto + pesos de pele → GLB com skin) e (2) um
**controlador de runtime** em `site/src/beasts/<nome>.js` (o movimento). `tools/make-creature.mjs <nome>` roda tudo:
prep (solda/decima) → **rig** → optimize (WebP + Meshopt) → `site/public/models/<nome>-{web,lite}.glb`.

Método de trabalho (pedido do usuário, 15/10/2026): **uma fera por vez**. Cada uma tem um briefing escrito por ele (estilo
"Rigging TD"); terminada uma, avisa-se e ele passa o briefing da próxima.

| fera | estado | briefing |
|---|---|---|
| dragão (Qinglong) | **pronto** (esta pasta + `site/src/beasts/dragon.js`) | abaixo |
| fênix (Zhuque) | **pronto** (`fenix.mjs` + `site/src/beasts/fenix.js`) | abaixo |
| tigre branco (Baihu) | aguardando briefing | — |
| tartaruga negra + serpente (Xuanwu) | aguardando briefing | — |

## Dragão — briefing e o que foi entregue

O briefing é escrito em vocabulário de Blender; Blender não é usado (nem instalado) e o glTF não tem B-Bones nem
restrições de Spline IK. Cada pedido virou o equivalente que existe na web:

| pedido | entrega |
|---|---|
| **Spline IK** de ponta a ponta, atrelado a uma curva guia | `SplineIK` (`site/src/beasts/rigkit.js`): curva Catmull-Rom por 12 *handles* conduz a cadeia de 52 juntas; as juntas ficam NA curva com o comprimento dos ossos preservado (sem esticar), orientação por transporte paralelo, expresso RELATIVO à curva de repouso (guia = repouso ⇒ exatamente a pose esculpida, verificado). A cabeça tem junta própria sob o topo do pescoço. |
| **B-Bones** (escamas deslizam sem amassar nem perder volume em 'S') | cadeia densa (52 juntas, espaçadas 0,045 < raio do corpo) com pesos **B-spline cúbicos** (4 vizinhos, C²) — a suavidade do Bendy-Bone; mais um **limite de curvatura por junta** derivado do raio real do corpo (`extras.spineRadius`), que impede o colapso em qualquer pose que a cena peça. |
| **bigodes e crina**: micro-ossos FK com pesos em gradiente, animáveis à mão | 2 bigodes × 6 ossos + **28 mechas** de crina/franja × 3 ossos, extraídos da malha (fios finos por espessura volumétrica; mechas por componente conectado). `Strand` (Verlet): rigidez que decai da raiz à ponta, gravidade, vento, inércia do corpo. Pesos: a mecha toda se prende rígida ao ponto de fixação e a cadeia assume só a parte livre. Controle manual: `params.wind`, `Strand.manual`, ou escreva `bone.quaternion` depois do `update`. |
| **4 patas com IK simples** ancorado à espinha | IK de 2 ossos (quadril→joelho→tornozelo) com polo, **IK macio** (sem "estalo" ao esticar), ancorado ao osso da espinha. Modos: `passive` (pende com atraso e relaxa para a vertical), `rest` (pose esculpida), `orb` (as patas dianteiras sobem e as garras fecham em torno de uma esfera imaginária ancorada ao peito). |

### Esqueleto (`tools/rigs/dragon.mjs`)
`Spine_51` (raiz, topo do pescoço) → `Spine_50 … Spine_00` (ponta da cauda) · `Head` → `HeadTip` ·
`Leg_{FL,FR,HL,HR}_{1..4,Tip}` · `Whisker_{LA,RA}_{1..6,Tip}` · `Mane_<n>_{1..3,Tip}` — ~200 juntas na web, ~150 na lite.
Todas com rotação de repouso identidade (eixos locais = eixos do modelo). Metadados em `userData` da raiz (`extras`).
A espinha é o **eixo medial** do volume (voxelização + campo de distância; o caminho mais curto pela superfície abraça o
dorso e erra o centro).

### Runtime (`site/src/beasts/dragon.js`)
```js
const dragon = createDragon(gltf.scene);       // GLB web ou lite, ambos têm a mesma API
dragon.params.amp = 1.2;                       // ondulação (0 = pose esculpida)
dragon.update(dt);                             // todo quadro (~0,3 ms por quadro; era ~1,2 ms antes de 15/10 à noite)
dragon.pose({ amp: 2, t: 1.5 });               // pose determinística para testes
```
Parâmetros principais (`DRAGON_DEFAULTS`): `amp`, `lateral`, `vertical`, `waveLength`, `frequency`, `tailGain`,
`headYaw/Pitch/Roll`, `headStabilise`, `legMode`, `legRelax`, `orbHold`, `orbCenter/Radius/Legs`, `wind`, `gravity`.
Nenhum osso gira mais rápido que um limite por grupo (`slew`): mesmo um salto brusco de parâmetros não "estala".

### Como ver e verificar
- **Laboratório ao vivo:** `npm run dev` em `site/` → `http://localhost:5173/dragon-lab.html` (`?m=lite` para a lite). Só
  dev: o build do Vite só inclui `index.html`.
- `node tools/make-creature.mjs dragon` regera os GLBs. `node tools/rigs/dragon.mjs <prep.glb> <out.glb>` roda só o rig.
- Depuração: `tools/rigs/lib/weights-debug.mjs` (pinta cada vértice pelo osso dominante),
  `tools/rigs/lib/thin-debug.mjs` (espessura local → o que é fio/mecha).
- Provas feitas em 15/10/2026: pose de repouso = escultura (sem rasgos); S extremo (amp 2,6) sem lâminas esticadas depois
  do agrupamento por mecha; 900 quadros sem NaN; salto brusco de parâmetros ≤ 20°/quadro; ~0,3 ms de CPU por quadro.

### Limites conhecidos
- Pesos automáticos: os 4 influenciadores por vértice (limite do three.js) misturam espinha+perna na virilha; em torções
  acima de ~60° nas patas pode aparecer dobra leve.
- A cauda tem um leque de cabelo grande ligado por UMA cadeia de 3 ossos (move rígido): bom de longe, perde a ondulação
  interna em close.
- Custo de GPU de malha skinada não foi medido no palco real (o hero ainda não tem cena); ver "Performance" no HANDOFF.

## Fênix — briefing e o que foi entregue

Briefing em `model/fenix/rig-fenix.md` (leque nas asas por constraints, transição peito→pescoço, plumas de cauda em fita).
Blender continua fora; o que o briefing pede virou:

| pedido | entrega |
|---|---|
| **Asa em IK** (ombro→cotovelo→pulso) | braço extraído como o eixo medial da parte mais grossa da asa (a borda de ataque coberta de escamas); IK de 2 ossos com pólo e IK macio. Parâmetros: `open` (0,35 meio fechada · 0,75 pose esculpida · 1,3 estendida), `flap`, `sweep`. |
| **Leque automático das penas** (Copy Rotation / Transformation) sem clipping | 9–10 *colunas de penas* por asa (3 ossos cada), penduradas no braço, estimadas da própria malha (direção robusta por cone de 35°). Ao abrir/fechar cada coluna gira em torno da normal da folha, **mais quanto mais longe do ombro**: abrem em ordem, sem se cruzar. `fanGain`, `fanSpread`, `fanClose`, `fanCurl` (as pontas curvam). |
| **Peito → pescoço com gradiente longo** | pesos B-spline cúbicos no tronco e uma transição suave (smootherstep) por TODO o pescoço até a junta da cabeça; em movimento a rotação da cabeça é repartida entre 6 ossos (4 % → 30 %). O peito escamado não sente a cabeça girar. |
| **Plumas em fita**: Spline IK curta por fita, 2 controladores | 5 fitas principais (máximos locais da distância na superfície, com divergência), cada uma uma cadeia de 8 ossos com `SplineIK` de 4 handles dirigido por 2 controles: **base** e **ponta** (a ponta segue com inércia + onda). |

Esqueleto: `Pelvis` (raiz) → `Spine_1..4` → `Neck_1..6` → `Head` · `Wing_{L,R}_{Shoulder,Elbow,Wrist,Hand}` +
`Wing_{L,R}_F<nn>_{1..3,Tip}` · `Tail_<k>_{1..8,Tip}` · `Leg_{L,R}_{1..4,Tip}` · `Crest_<nn>_{1..6,Tip}` (penacho e os dois
fios longos do rosto, como `Strand` Verlet). ~190 juntas na web, ~165 na lite. L = esquerda da criatura (−X).

Laboratório: `http://localhost:5173/fenix-lab.html` (`?m=lite`). Controlador: `createFenix(gltf.scene)`, `update(dt)`, `params`
(`FENIX_DEFAULTS`).

### Provas e limites (fênix)
- Pose de repouso = escultura (sem rasgos); abertura 1,25 e meia-dobra 0,45 limpas; 900 quadros sem NaN, ≤ 8°/quadro nas
  asas (limitador de velocidade), ~0,25 ms de CPU por quadro; validador glTF 0 erros.
- **Dobra total (open < 0,35) NÃO é suportada:** a escultura é uma asa aberta; dobrá-la por completo estica as folhas de
  penas (lâmina plana + cacos). O controlador limita `open` a `minOpen = 0,35`. Dobra completa pediria uma 2ª pose (gerar
  uma fênix de asas fechadas) ou penas separadas em malhas próprias — decisão de arte, não de rig.
- **Faixas recomendadas:** `open` 0,35–1,3 · `flap` ±0,4 rad · `sweep` ≤ 0,6 · `lookYaw` ±1,0. Combinações extremas (open 1,3 + flap 0,55 +
  sweep 0,7) esticam as folhas de penas. De frente a asa levantada aparece de borda: avalie a batida em 3/4 ou de lado.
- A cauda tem 5 fitas independentes; as ~8 reais se fundem no feixe, então fitas vizinhas se movem em bloco.
- Pernas: só FK de "recolher" (`legTuck`); IK de pernas não foi pedido.

### Pairar (hero) — `site/src/beasts/fenix-hover.js`
Piloto que só escreve as entradas do rig (`open`, `flap`, `sweep`, `featherTrail`, `bodyAccel`, `look*`, `legTuck`) e o
`Pelvis`: a batida (descida/subida assimétricas), o heave e o balanço do corpo, a deriva lenta, a cabeça estável. Uso:
`const hover = createHover(fenix); hover.update(dt, clockOuNull)` e depois `fenix.update(dt)`. `intensity` 0..1 vai de "respirando"
a batida cheia (use 0,25 com `prefers-reduced-motion`). O rig ganhou `featherTrail` (as penas arrastam com a batida) e
`bodyAccel`/`plumeInertia` (as fitas seguem a aceleração do corpo).

### Correção da fênix após a análise do vídeo (15/10/2026, tarde)
- **Causa:** as penas da asa eram dos ossos do braço no miolo e das colunas só nas pontas, em manchas (posse pelo raio mais
  próximo). Ao girar o leque as manchas cisalhavam e a folha amassava. **Agora** cada vértice da asa é pesado pela posição ao
  longo do braço (s) e pela distância a ele (d): colunas vizinhas interpoladas em s, osso da cadeia por d/alcance. O campo de
  deformação é contínuo; nunca se descartam colunas (as faltantes são interpoladas).
- O polo do cotovelo gira junto com a batida (antes o braço rolava sobre o próprio eixo ao subir).
- A cabeça (bico, penacho) nunca entra na região da asa (o bico estava sendo esticado).
- **Corte de triângulos esticados:** `tools/rigs/scan-tears.mjs` pele a malha no navegador em 24 fases da batida e em 7 poses
  de estresse e lista os triângulos com aresta > 5× o repouso (e > 0,04). A lista (`tools/rigs/cuts/fenix-{web,lite}.json`,
  0,5–0,7 % dos triângulos) é aplicada pelo construtor, que depois remove ilhas flutuantes (< 150 triângulos). Reescaneando a
  malha final: **0 arestas esticadas** nas 31 poses. Se mudar o prep, apague os JSON e regere (scan → rebuild).
- Limite que ficou: com a asa bem aberta (fase 0,25) e vista de frente a folha se mostra plana e a parte de baixo das
  coberturas aparece; é geometria da escultura (a asa é uma folha em camadas), não deformação.
