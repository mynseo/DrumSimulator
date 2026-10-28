"""어쿠스틱 드럼 킷 샘플을 만든다.

원본: Versilian Community Sample Library (VCSL), CC0 1.0 (퍼블릭 도메인)
      https://github.com/sgossner/VCSL

사용법:
    git clone --depth 1 https://github.com/sgossner/VCSL /tmp/VCSL
    python3 scripts/prepare_samples.py /tmp/VCSL [이름 …]   (이름을 주면 그 샘플만 다시 만든다)

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


def shape(x, lo=None, hi=None):
    """주파수 영역에서 부드럽게 거르기 (lo 아래·hi 위를 줄인다)"""
    sp = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / RATE)
    g = np.ones_like(f)
    if lo:
        g *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1)) ** 4)
    if hi:
        g *= 1 / np.sqrt(1 + (f / hi) ** 4)
    return np.fft.irfft(sp * g, len(x)).astype(np.float32)


def from_bloom_peak(x):
    """말렛으로 친 심벌은 소리가 천천히 부풀어 오른다. 가장 커진 곳부터 쓰면 처음부터 꽉 찬 울림이 된다"""
    hop = int(0.01 * RATE)
    env = np.array([np.sqrt(np.mean(x[k:k + hop] ** 2)) for k in range(0, len(x) - hop, hop)])
    start = max(0, int(np.argmax(env)) * hop - int(0.005 * RATE))
    y = x[start:].copy()
    y[:int(0.004 * RATE)] *= np.linspace(0, 1, int(0.004 * RATE))
    return y


def build_crash(vcsl, max_len):
    """
    드럼 세트 크래시: VCSL에는 드럼 세트용 크래시 녹음이 없어 세 가지를 겹친다.
    - 스틱으로 친 서스펜디드 심벌: 날카로운 첫 타격
    - 말렛으로 세게(fff) 친 심벌을 가장 커진 곳부터: 스틱 어깨로 쳤을 때의 꽉 찬 "촤아" 울림
    - 높은 잡음: 스틱 어깨가 가장자리를 긁는 "쉬익"과 오래 남는 반짝임
    """
    stick = load(os.path.join(vcsl, f'{I}/Suspended Cymbal 1/susCymb1_hit_stick_f1.wav'))
    a = np.abs(stick)
    stick = stick[max(0, int(np.argmax(a > a.max() * 0.1)) - int(0.002 * RATE)):]
    wash = from_bloom_peak(load(os.path.join(vcsl, f'{I}/Suspended Cymbal 2/susCymb2_hit_fff1.wav')))
    n = int(max_len * RATE)
    stick = np.pad(stick, (0, max(0, n - len(stick))))[:n] / np.abs(stick).max()
    wash = np.pad(wash, (0, max(0, n - len(wash))))[:n] / np.abs(wash).max()
    t = np.arange(n) / RATE
    rng = np.random.default_rng(7)
    hiss = shape(rng.standard_normal(n).astype(np.float32), lo=6000, hi=16000)
    hiss *= (0.7 * np.exp(-t / 0.05) + 0.3 * np.exp(-t / 1.2)) / np.abs(hiss).max()
    x = 0.75 * stick + 1.0 * wash + 0.8 * hiss
    x = shape(x, lo=180)
    fade = int(n * 0.3)
    x[-fade:] *= np.linspace(1, 0, fade) ** 2
    return x * (10 ** (-1 / 20) / np.abs(x).max())


def main(vcsl):
    os.makedirs(OUT, exist_ok=True)
    jobs = {name: (lambda rel=rel, max_len=max_len: process(load(os.path.join(vcsl, rel)), max_len)) for name, (rel, max_len) in SAMPLES.items()}
    jobs['crash'] = lambda: build_crash(vcsl, 3.5)
    only = sys.argv[2:]
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
    main(sys.argv[1])
