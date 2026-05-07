# OpenCode MiniMax Financial Analysis

**Date**: 2026-05-07
**Status**: Complete

## Executive Summary

This report analyzes the cost-effectiveness of running MiniMax M2.5 for OpenCode sessions across three infrastructure options: OpenCode Zen (cloud), Apple M3 Ultra (local), and dedicated server (cloud rental or purchase).

## Usage Baseline

Based on user's actual OpenCode usage on 2026-05-06:

| Metric | Daily | Monthly (30 days) |
|--------|-------|-------------------|
| Input tokens | 375K | ~11.3M |
| Output tokens | 2.3M | ~69M |
| Cache Read | 359M | ~10.8B |
| Cache Write | 17M | ~510M |
| **Total Cost** | **$30.66** | **$920/month** |

---

## Option 1: OpenCode Zen (Cloud)

| Aspect | Value |
|--------|-------|
| Model | MiniMax M2.5 (standard ~50 tok/s) |
| Speed | 50-100 tok/s |
| Accuracy | 100% (SWE-bench 80.2%) |
| Monthly cost | **$920/month** |
| Pros | No setup, always-on, full quality |
| Cons | Recurring cost, no data privacy |

---

## Option 2: Apple M3 Ultra 256GB (Local)

**Critical Note**: Apple discontinued 512GB M3 Ultra option in March 2026. Maximum available is now 256GB.

| Aspect | Value |
|--------|-------|
| Hardware | M3 Ultra 256GB ($6,599) |
| Model | MiniMax M2.5 6-bit quant (~186GB) |
| Speed | ~38 tok/s |
| Accuracy | ~90-95% (vs full FP8) |
| Amortization (3yr) | $183/month |
| Electricity | ~$2.18/month (50W idle × 12hrs) |
| **Total monthly** | **$185/month** |
| **Break-even** | **8.9 months vs cloud** |

### Memory Constraints

- 256GB can only fit 6-bit quantization (not 8-bit or FP8)
- Single session with long context risks OOM
- **Cannot run 5 concurrent sessions** on M3 Ultra 256GB

---

## Option 3: Dedicated Server (Cloud Rental)

### Hugging Face Inference Endpoints

Hardware: 2× NVIDIA A100 (160GB VRAM) for NVFP4 quantization

| Usage Pattern | Hours/Day | Monthly (20 days) | Cost |
|---------------|-----------|-------------------|------|
| 8-hour workday | 8 | 160 hours | $800/month |
| 10-hour workday | 10 | 200 hours | $1,000/month |

**Pause/Resume Support**: Yes — can pause nights/weekends, only pay for active hours.

| Aspect | Value |
|--------|-------|
| Model | MiniMax M2.5 NVFP4 |
| Speed | 85-89 tok/s |
| Accuracy | ~86% MMLU-Pro (some report lower code quality) |
| Monthly (8hr/day) | $800/month |
| Pros | Pausable, decent performance, faster than M3 Ultra |
| Cons | Still quantized, needs internet |

---

## Option 4: Full Server Purchase (4× H100)

| Aspect | Value |
|--------|-------|
| Hardware | 4× H100 80GB (~$80,000) |
| Model | MiniMax M2.5 FP8 (full quality) |
| Speed | 80-100 tok/s |
| Amortization (3yr) | $2,222/month |
| Electricity | $121/month (2.8kW × 12hrs × $0.12/kWh) |
| Colocation | ~$200/month |
| **Total monthly** | **$2,543/month** |

**Verdict**: Not cost-effective at this usage scale — 2.8× the cloud cost.

---

## Summary Comparison

| Option | Speed | Accuracy | Monthly (Amortized) | Break-even |
|--------|-------|----------|---------------------|------------|
| OpenCode Zen | 50-100 tok/s | 100% | $920 | — |
| M3 Ultra 256GB | 38 tok/s | ~90-95% | $185 | 8.9 months |
| HF A100×2 (8hr) | 85-89 tok/s | ~90% | $800 | 6.1 months |
| HF A100×2 (10hr) | 85-89 tok/s | ~90% | $1,000 | N/A |
| 4× H100 purchase | 80-100 tok/s | 100% | $2,543 | N/A |

---

## MiniMax Quantization Impact

| Quantization | SWE-bench | VRAM | Speed |
|--------------|-----------|------|-------|
| FP8 (original) | 80.2% | 4× GPU | ~71 tok/s |
| NVFP4 | ~86% (MMLU) | 2× GPU | 85-89 tok/s |
| 4-bit GGUF | ~80% | 128GB | ~20-26 tok/s |
| 3-bit GGUF | ~80% | 112GB | ~20 tok/s |

**Note**: NVFP4 scores slightly higher on MMLU-Pro but some users report noticeably lower code quality. Recommendation: use BF16 KV cache if seeing quality issues.

---

## Conclusion

For the user's workload (~$920/month cloud):

1. **Best value**: M3 Ultra 256GB at $185/month — but cannot handle 5 concurrent sessions, limited to single session with 6-bit quant
2. **Best for concurrent sessions**: Hugging Face A100×2 at $800/month — pausable, supports multiple sessions
3. **Never buy**: Full server purchase at $2,543/month — more expensive than cloud

**Recommendation**: If local inference is a priority, wait for M5 Ultra Mac Studio or explore multi-M3 Ultra Thunderbolt clustering. Otherwise, OpenCode Zen at $920/month remains the practical choice.