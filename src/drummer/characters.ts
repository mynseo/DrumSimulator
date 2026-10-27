import type { CharacterDef } from './DrummerRig';
import { ProceduralRig } from './ProceduralRig';

/**
 * 고를 수 있는 캐릭터 목록. 새 캐릭터는 여기에 CharacterDef 하나를 추가하면 된다.
 * (예정) glTF 모델: create()에서 GLTFLoader로 불러온 뼈대에 DrummerPose를 IK로 적용하는 리그를 반환.
 */
export const CHARACTERS: CharacterDef[] = [
  {
    id: 'drummer',
    name: '드러머',
    create: () =>
      new ProceduralRig({ skin: 0xffd9bf, shirt: 0x5b8def, pants: 0x34405e, shoes: 0xf2f2f2, stick: 0xe6c690, head: 'human', hair: 0x4a2c20, hairStyle: 'bob' }),
  },
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
      new ProceduralRig({ skin: 0xf1c3a0, shirt: 0xe23d5b, pants: 0x1e1e26, shoes: 0x1e1e26, stick: 0xf5f0e6, head: 'human', hair: 0xffd23f, hairStyle: 'spiky', bulk: 0.95 }),
  },
];
