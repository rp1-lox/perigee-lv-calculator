# Silverbird black-box probe campaign - 2026-07-18
# Source of truth for the LV_MSCORR_* fit (140-physics.js) - see MATH.md critique 121.
# All probes: CalMode=Raw, user-defined vehicles, site lat 28.5 az 37-112, Two-Burn, GCS.
# Fit: extra_dv = 1.0313*TaFull - 1.0667*X - 1.4664 (multi-stage), holdout-validated.

## Round 1-2 (LEO 185x185 @28.5 + variations, manual probes)
ss thr1500 isp350: 2990 | ss thr2500 isp350: 3990 | ss thr4000 isp350: 4856
ss thr2500 isp300: 933 | ss thr2500 isp450: 11132
A 3stg i350: 15077 | B 2stg i350: 14798 | C SatV-2stg: 116614 | D SatV fastS3: 131088
E SatV all304: 55399 | SatV baseline: 119002 | SatV inc45: 115861 | SatV inc90: 34161

## Round 3 (campaign)
{"label":"cal_V1_2stg_lowTWup_leo","payload":12751}
{"label":"cal_V2_2stg_hiTWup_leo","payload":15676}
{"label":"cal_V3_3stg_med_leo","payload":26291}
{"label":"cal_V4_f9ish_leo","payload":19419}
{"label":"cal_V5_electronish_leo","payload":305}
{"label":"cal_V6_3stg_longS3_leo","payload":24982}
{"label":"cal_V7_2stg_hydro_leo","payload":19397}
{"label":"cal_V8_f9ish_fastS2_leo","payload":22649}
{"label":"val_SatV_800circ","payload":107241}
{"label":"val_SatV_gto","payload":53997}
{"label":"val_SatV_meo20k","payload":37082}
{"label":"val_SatV2stg_gto","payload":39821}
{"label":"val_V4_f9ish_800","payload":16838}
{"label":"val_V4_f9ish_gto","payload":5849}
{"label":"val_V3_3stg_gto","payload":12974}
{"label":"val_V3_3stg_800","payload":23846}
{"label":"val_ss2500_800","payload":3087}
{"label":"val_V6_gto","payload":12759}
{"label":"val_V1_800","payload":11197}
