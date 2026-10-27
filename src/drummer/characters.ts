import type { CharacterDef } from './DrummerRig';
import { GltfRig } from './GltfRig';
import { ProceduralRig } from './ProceduralRig';

/**
 * 고를 수 있는 캐릭터 목록. 새 캐릭터는 여기에 CharacterDef 하나를 추가하면 된다.
 * 뼈대가 있는 3D 모델(glTF)은 GltfRig로 붙인다.
 */
/** 아티팩트 빌드는 .glb를 내줄 수 없어 같은 모델을 glTF JSON으로 싣는다 (scripts/build-artifact.mjs) */
const modelUrl = (name: string) => `models/${name}.${import.meta.env.VITE_TARGET === 'artifact' ? 'json' : 'glb'}`;

/**
 * KayKit Character Pack: Adventurers (Kay Lousberg, CC0) 캐릭터. scripts/prepare_models.mjs 참고.
 * 팩의 캐릭터는 뼈대와 비율이 같아서 같은 맞춤값을 쓴다.
 */
function kaykit(id: string, name: string): CharacterDef {
  const url = modelUrl(id);
  return {
    id,
    name,
    model: url,
    create: () =>
      new GltfRig({
        url,
        // 원본은 키 2.3(머리만 1) 단위의 2등신: 전체를 줄이고, 짧은 팔다리는 관절 사이를 늘려
        // 드럼과 페달에 닿게 한다
        scale: 0.62,
        limbStretch: { arm: 1.5, leg: 1.9 },
        seat: { height: 0.36, z: 0.3 },
        hipsAboveSeat: 0.05,
        hipsBack: -0.02,
        basePose: 'Sit_Chair_Pose',
        stick: 0xe6c690,
      }),
  };
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'drummer',
    name: '드러머',
    create: () =>
      new ProceduralRig({ skin: 0xffd9bf, shirt: 0x5b8def, pants: 0x34405e, shoes: 0xf2f2f2, stick: 0xe6c690, head: 'human', hair: 0x4a2c20 }),
  },
  kaykit('knight', '기사 (KayKit)'),
  kaykit('rogue', '도적 (KayKit)'),
  {
    id: 'cat',
    name: '고양이',
    create: () =>
      new ProceduralRig({ skin: 0xf6b26b, shirt: 0xffe08a, pants: 0x8a6bbf, shoes: 0xff8fa3, stick: 0xf5f0e6, head: 'cat', bulk: 1.05 }),
  },
  {
    id: 'robot',
    name: '로봇',
    create: () =>
      new ProceduralRig({ skin: 0xdfe6ee, shirt: 0xc9d3de, pants: 0x9aa7b5, shoes: 0x3a3f48, stick: 0x35f0ff, head: 'robot', glow: 0x35f0ff, bulk: 1.1 }),
  },
  {
    id: 'rocker',
    name: '록커',
    create: () =>
      new ProceduralRig({ skin: 0xf1c3a0, shirt: 0xe23d5b, pants: 0x1e1e26, shoes: 0x1e1e26, stick: 0xf5f0e6, head: 'human', hair: 0xffd23f, bulk: 0.95 }),
  },
];
