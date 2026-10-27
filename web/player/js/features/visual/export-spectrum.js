'use strict';

// Analyse a known PCM window using Web Audio's Blackman window, FFT bins and
// decibel range. The export clock supplies the audio position without playback.
(function (global) {
  function Spectrum(size, sampleRate) {
    this.size = size || 2048; this.sampleRate = sampleRate || 48000;
    if (!Number.isInteger(this.size) || this.size < 32 || this.size > 32768 || this.size & this.size - 1) throw new Error('Invalid FFT size');
    this.real = new Float64Array(this.size); this.imag = new Float64Array(this.size);
    this.previous = new Float64Array(this.size / 2);
    this.frequency = new Uint8Array(this.size / 2); this.time = new Uint8Array(this.size);
    this.time.fill(128);
    this.window = Float64Array.from({length:this.size}, function (_, i) {
      return .42 - .5 * Math.cos(2 * Math.PI * i / this.size) + .08 * Math.cos(4 * Math.PI * i / this.size);
    }, this);
  }
  Spectrum.prototype.update = function (pcm) {
    var n = this.size, real = this.real, imag = this.imag;
    for (var i = 0; i < n; i++) {
      var sample = Number(pcm[i]) || 0;
      real[i] = sample * this.window[i]; imag[i] = 0;
      this.time[i] = Math.max(0, Math.min(255, Math.floor((sample + 1) * 128)));
    }
    for (var a = 1, b = 0; a < n; a++) {
      var bit = n >> 1;
      for (; b & bit; bit >>= 1) b ^= bit;
      b ^= bit;
      if (a < b) { var swap = real[a]; real[a] = real[b]; real[b] = swap; }
    }
    for (var length = 2; length <= n; length <<= 1) {
      var angle = -2 * Math.PI / length, stepR = Math.cos(angle), stepI = Math.sin(angle);
      for (var start = 0; start < n; start += length) {
        var wr = 1, wi = 0;
        for (var offset = 0; offset < length / 2; offset++) {
          var even = start + offset, odd = even + length / 2;
          var tr = wr * real[odd] - wi * imag[odd], ti = wr * imag[odd] + wi * real[odd];
          real[odd] = real[even] - tr; imag[odd] = imag[even] - ti;
          real[even] += tr; imag[even] += ti;
          var nr = wr * stepR - wi * stepI; wi = wr * stepI + wi * stepR; wr = nr;
        }
      }
    }
    for (var k = 0; k < n / 2; k++) {
      var magnitude = Math.hypot(real[k], imag[k]) / n;
      magnitude = this.previous[k] * .8 + magnitude * .2;
      this.previous[k] = magnitude;
      var db = 20 * Math.log10(Math.max(1e-12, magnitude));
      this.frequency[k] = Math.max(0, Math.min(255, Math.floor((db + 100) * 255 / 70)));
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = {Spectrum:Spectrum};
  else global.MineradioExportSpectrum = Spectrum;
})(typeof window === 'undefined' ? globalThis : window);
