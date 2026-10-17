import { Bloom, EffectComposer, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type { Quality } from "../store/store";

/** Medium/High: HDR bloom on lit windows, lamps, beacons and route glows, then ACES tone mapping; MSAA on High, SMAA on Medium. */
export default function PostFX({ quality }: { quality: Quality }) {
  if (quality === "high")
    return (
      <EffectComposer multisampling={4}>
        <Bloom intensity={1.25} luminanceThreshold={0.9} luminanceSmoothing={0.35} mipmapBlur radius={0.75} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.3} darkness={0.62} eskil={false} />
      </EffectComposer>
    );
  return (
    <EffectComposer multisampling={0}>
      <Bloom intensity={1.05} luminanceThreshold={0.9} luminanceSmoothing={0.35} mipmapBlur radius={0.65} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.3} darkness={0.62} eskil={false} />
      <SMAA />
    </EffectComposer>
  );
}
