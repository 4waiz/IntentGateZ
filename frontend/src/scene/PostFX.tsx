import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";

/** High quality only: a restrained bloom on emissive lights and route glows. */
export default function PostFX() {
  return (
    <EffectComposer multisampling={4}>
      <Bloom intensity={0.75} luminanceThreshold={0.42} luminanceSmoothing={0.25} mipmapBlur radius={0.7} />
      <Vignette offset={0.32} darkness={0.55} eskil={false} />
    </EffectComposer>
  );
}
