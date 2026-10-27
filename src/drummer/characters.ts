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
      new ProceduralRig({ skin: 0xe0b48f, shirt: 0x24262b, pants: 0x2d3e5c, shoes: 0x111111, stick: 0xe6c690, head: 'human', hair: 0x2a1a10 }),
  },
  {
    id: 'robot',
    name: '로봇',
    create: () =>
      new ProceduralRig({ skin: 0xb8c0c8, shirt: 0x9aa3ad, pants: 0x6c757d, shoes: 0x30343a, stick: 0x35f0ff, head: 'robot', bulk: 1.1 }),
  },
  {
    id: 'rocker',
    name: '록커',
    create: () =>
      new ProceduralRig({ skin: 0xc68a63, shirt: 0xb3122e, pants: 0x111114, shoes: 0xeeeeee, stick: 0xf5f0e6, head: 'human', hair: 0xd9b23a, bulk: 0.9 }),
  },
];
