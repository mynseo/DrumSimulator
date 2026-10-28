import type { CharacterDef } from './DrummerRig';
import { ProceduralRig } from './ProceduralRig';

/**
 * 고를 수 있는 캐릭터 목록. 새 캐릭터는 여기에 CharacterDef 하나를 추가하면 된다.
 * 뼈대가 있는 3D 모델(glTF)은 GltfRig로 붙인다 (README 참고).
 */
export const CHARACTERS: CharacterDef[] = [
  {
    id: 'drummer',
    name: '드러머',
    create: () =>
      new ProceduralRig({ skin: 0xffd9bf, shirt: 0x5b8def, pants: 0x34405e, shoes: 0xf2f2f2, stick: 0xe6c690, head: 'human', hair: 0x4a2c20 }),
  },
  {
    id: 'cat',
    name: '고양이',
    create: () =>
      new ProceduralRig({ skin: 0xf6b26b, shirt: 0xffe08a, pants: 0x8a6bbf, shoes: 0xff8fa3, stick: 0xf5f0e6, head: 'cat', bulk: 1.05 }),
  },
  {
    id: 'rocker',
    name: '록커',
    create: () =>
      // 금발 장발에 소리 지르는 얼굴, 박마다 크게 헤드뱅잉
      new ProceduralRig({ skin: 0xf1c3a0, shirt: 0x15151b, pants: 0x2b3a67, shoes: 0xe23d5b, stick: 0xf5f0e6, head: 'rocker', hair: 0xffd84a, bulk: 0.95, headbang: 4 }),
  },
];
