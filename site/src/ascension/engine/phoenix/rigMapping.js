// Editable rig mapping. RigAudit classifies the SmartRigArmature automatically from
// hierarchy + rest-pose geometry (names are only a hint). Any key set here overrides
// the automatic result, by bone name. Leave empty to trust the audit.
//
// Validated automatic result for fenix-flight-lite.glb (for reference):
//   root: Bone_000, pelvis: Bone_001, head: Spine_10
//   torso: Spine_00…Spine_06, neck: Spine_07…Spine_09, crestRoots: [Bone_042]
//   wingR (−Z, "F_wingA"): clavicle Bone_036 → shoulder Bone_035 → elbow Bone_034 →
//          wrist Bone_050 → hand Bone_049 → digit Bone_062 → Bone_061 (inner digit Bone_060)
//   wingL (+Z, "F_wingB"): clavicle Bone_039 → shoulder Bone_038 → elbow Bone_037 →
//          wrist Bone_055 → hand Bone_054 → digit Bone_066 → Bone_065 (inner digit Bone_064)
//   legR: Bone_013…Bone_009, legL: Bone_006…Bone_002
//   tail: Bone_019, Bone_025, Bone_031 (+ 49 F_tail feather chains)
//
// Example override:
//   export const RIG_MAPPING_OVERRIDE = { wingR: { digit: 'Bone_060', innerDigit: 'Bone_062' } };
export const RIG_MAPPING_OVERRIDE = {};
