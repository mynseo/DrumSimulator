"""어쿠스틱 드럼 킷 샘플을 만든다.

원본: Versilian Community Sample Library (VCSL), CC0 1.0 (퍼블릭 도메인)
      https://github.com/sgossner/VCSL
      크래시만 Karoryfer Swirly Drums, CC0 1.0 — https://github.com/sfzinstruments/karoryfer.swirly-drums

사용법:
    git clone --depth 1 https://github.com/sgossner/VCSL /tmp/VCSL
    git clone --depth 1 https://github.com/sfzinstruments/karoryfer.swirly-drums /tmp/swirly
    python3 scripts/prepare_samples.py /tmp/VCSL /tmp/swirly [이름 …]   (이름을 주면 그 샘플만 다시 만든다)

필요: ffmpeg, numpy
처리: 모노 변환 → 타격 직전(2ms)부터 자르기 → 길이 제한 + 끝부분 페이드아웃 → 피크 -1dBFS로 정규화 → mp3
세기 차이는 재생할 때 velocity로 주므로, 여러 세기로 녹음된 샘플은 음색 차이만 남긴다.
"""
import os
import subprocess
import sys

import numpy as np

RATE = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'samples', 'acoustic')
M = 'Membranophones/Struck Membranophones'
I = 'Idiophones/Struck Idiophones'

# 출력 이름: (원본 경로, 최대 길이 초)
SAMPLES = {
    'kick-soft': (f'{M}/Bass Drum 1/BDrumNew_hit_v5_rr1_Sum.wav', 0.9),
    'kick': (f'{M}/Bass Drum 1/BDrumNew_hit_v7_rr1_Sum.wav', 0.9),
    'snare-soft': (f'{M}/Snare Drum, Modern 1/Snare2_HitSN_v3_rr1_Mid.wav', 0.6),
    'snare': (f'{M}/Snare Drum, Modern 1/Snare2_HitSN_v6_rr1_Mid.wav', 0.6),
    'snare-hard': (f'{M}/Snare Drum, Modern 1/Snare2_HitSN_v9_rr1_Mid.wav', 0.6),
    'tom-hi-soft': (f'{M}/Tom 1/Stick/TomH_HitS_v2_rr1_Mid.wav', 0.9),
    'tom-hi': (f'{M}/Tom 1/Stick/TomH_HitS_v4_rr1_Mid.wav', 0.9),
    'tom-lo-soft': (f'{M}/Tom 2/Stick/TomL_HitS_v2_rr1_Mid.wav', 1.1),
    'tom-lo': (f'{M}/Tom 2/Stick/TomL_HitS_v4_rr1_Mid.wav', 1.1),
    'hihat-closed-soft': (f'{I}/Hi-Hat Cymbal/HiHat_HitC_v2_rr1_Mid.wav', 0.35),
    'hihat-closed': (f'{I}/Hi-Hat Cymbal/HiHat_HitC_v4_rr1_Mid.wav', 0.4),
    'hihat-open': (f'{I}/Hi-Hat Cymbal/HiHat_HitO_rr1_Mid.wav', 1.8),
    'hihat-pedal': (f'{I}/Hi-Hat Cymbal/HiHat_Close_rr1_Mid.wav', 0.3),
    'ride': (f'{I}/Suspended Cymbal 1/susCymb1_hit_stick_mp1.wav', 2.5),
    'ride-bell': (f'{I}/Suspended Cymbal 1/susCymb1_hit_bell_mf1.wav', 2.0),
}

# 드럼 세트 크래시: VCSL에는 오케스트라 심벌뿐이라, Karoryfer Swirly Drums(CC0)의 크래시 녹음을 쓴다
SWIRLY = {
    'crash-soft': ('Samples/crash/crash_vl6_rr1.wav', 3.0),
    'crash': ('Samples/crash/crash_vl12_rr1.wav', 3.5),
}


def load(path):
    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def process(x, max_len):
    a = np.abs(x)
    onset = max(0, int(np.argmax(a > a.max() * 0.1)) - int(0.002 * RATE))
    x = x[onset:onset + int(max_len * RATE)]
    fade = int(len(x) * 0.3)
    x[-fade:] *= np.linspace(1, 0, fade) ** 2
    return x * (10 ** (-1 / 20) / np.abs(x).max())


def main(vcsl, swirly):
    os.makedirs(OUT, exist_ok=True)
    jobs = {name: (lambda rel=rel, max_len=max_len: process(load(os.path.join(vcsl, rel)), max_len)) for name, (rel, max_len) in SAMPLES.items()}
    for name, (rel, max_len) in SWIRLY.items():
        jobs[name] = lambda rel=rel, max_len=max_len: process(load(os.path.join(swirly, rel)), max_len)
    only = sys.argv[3:]
    for name, make in jobs.items():
        if only and name not in only:
            continue
        x = make()
        out = os.path.join(OUT, f'{name}.mp3')
        subprocess.run(
            ['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', '-',
             '-codec:a', 'libmp3lame', '-q:a', '4', out],
            input=x.astype(np.float32).tobytes(), check=True,
        )
        print(f'{name:18s} {len(x) / RATE:4.2f}s {os.path.getsize(out) // 1024:4d}KB')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
