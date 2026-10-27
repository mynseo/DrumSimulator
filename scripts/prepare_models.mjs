// KayKit 캐릭터(기사·도적)를 시뮬레이터용으로 다듬는다.
//
// 원본: KayKit - Character Pack: Adventurers 1.0 by Kay Lousberg, CC0 1.0
//       https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
//
// 사용법:
//   git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 /tmp/kaykit
//   node scripts/prepare_models.mjs /tmp/kaykit
//
// 처리: 앉은 자세(Sit_Chair_Pose) 애니메이션 하나만 남기고, 무기·방패를 빼고, 쓰지 않는 데이터를 정리하고, 정점 데이터를 압축한다.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize } from '@gltf-transform/functions';
import { statSync } from 'node:fs';
import { join } from 'node:path';

const KEEP_ANIMATIONS = new Set(['Sit_Chair_Pose']);
const REMOVE_NODES = /(Sword|Shield|Knife|Crossbow|Throwable)/;
/** 출력 이름 → 원본 파일 */
const MODELS = { knight: 'Knight.glb', rogue: 'Rogue.glb' };

// 확장(정점 압축 KHR_mesh_quantization 등)을 등록해야 파일에 그 선언이 남는다
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const [name, file] of Object.entries(MODELS)) {
  const src = join(process.argv[2], 'addons/kaykit_character_pack_adventures/Characters/gltf', file);
  const out = `public/models/${name}.glb`;
  const doc = await io.read(src);
  const root = doc.getRoot();
  // 남길 애니메이션이 쓰는 키프레임 데이터 (다른 애니메이션과 같이 쓰는 경우가 있다)
  const kept = new Set();
  for (const a of root.listAnimations()) {
    if (KEEP_ANIMATIONS.has(a.getName())) for (const s of a.listSamplers()) kept.add(s.getInput()).add(s.getOutput());
  }
  for (const a of root.listAnimations()) {
    if (KEEP_ANIMATIONS.has(a.getName())) continue;
    // 애니메이션만 지우면 키프레임 데이터가 남으므로 샘플러와 그 데이터까지 지운다
    for (const s of a.listSamplers()) {
      for (const acc of [s.getInput(), s.getOutput()]) if (acc && !kept.has(acc)) acc.dispose();
      s.dispose();
    }
    a.listChannels().forEach((c) => c.dispose());
    a.dispose();
  }
  for (const n of root.listNodes()) if (REMOVE_NODES.test(n.getName())) n.dispose();
  // quantize: 정점 데이터를 작은 정수로 저장 (three.js가 그대로 읽는다, KHR_mesh_quantization)
  await doc.transform(prune(), dedup(), quantize());
  await io.write(out, doc);
  console.log(`${out}: ${(statSync(out).size / 1024).toFixed(0)} KB, animations: ${root.listAnimations().map((a) => a.getName())}`);
}
