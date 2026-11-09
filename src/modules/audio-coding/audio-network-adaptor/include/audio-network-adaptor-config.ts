// Port of modules/audio_coding/audio_network_adaptor/include/audio_network_adaptor_config.h @ M154
// (AudioEncoderRuntimeConfig).

export class AudioEncoderRuntimeConfig {
  bitrateBps: number | undefined = undefined;
  frameLengthMs: number | undefined = undefined;
  // Note: This is what we tell the encoder. It doesn't have to reflect
  // the actual NetworkMetrics; it's subject to our decision.
  uplinkPacketLossFraction: number | undefined = undefined; // float
  enableFec: boolean | undefined = undefined;
  enableDtx: boolean | undefined = undefined;
  // Some encoders can encode fewer channels than the actual input to make
  // better use of the bandwidth. `num_channels` sets the number of channels
  // to encode.
  numChannels: number | undefined = undefined;
  // This is true if the last frame length change was an increase, and otherwise
  // false.
  lastFlChangeIncrease = false;
}
