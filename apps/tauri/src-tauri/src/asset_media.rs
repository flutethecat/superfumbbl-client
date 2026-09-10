use std::{
    fs::File,
    io::{Cursor, Read},
    path::Path,
};

use image::{imageops::FilterType, ImageEncoder, Rgba, RgbaImage};
use symphonia::core::{
    audio::SampleBuffer,
    codecs::{
        DecoderOptions, CODEC_TYPE_MP3, CODEC_TYPE_PCM_S16LE, CODEC_TYPE_PCM_S24LE,
        CODEC_TYPE_PCM_S32LE, CODEC_TYPE_PCM_U8, CODEC_TYPE_VORBIS,
    },
    errors::Error,
    formats::FormatOptions,
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
};

pub(crate) const MAX_SOURCE_BYTES: usize = 16 * 1024 * 1024;
const MAX_SOURCE_PIXELS: u64 = 16_777_216;
const MAX_AUDIO_SECONDS: u64 = 20;
const MAX_AUDIO_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_AUDIO_PACKETS: usize = 100_000;

#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scaling {
    Linear,
    Nearest,
}

pub struct NormalizedImage {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub extension: &'static str,
    pub mime: &'static str,
}

pub struct NormalizedSound {
    pub bytes: Vec<u8>,
    pub duration_ms: u32,
    pub channels: u8,
    pub sample_rate: u32,
}

fn media_error() -> String {
    "Selected media is invalid or unsupported".into()
}

fn read_source(path: &Path) -> Result<Vec<u8>, String> {
    let before = std::fs::symlink_metadata(path).map_err(|_| media_error())?;
    if !before.is_file()
        || super::asset_mods::metadata_is_reparse(&before)
        || before.len() > MAX_SOURCE_BYTES as u64
    {
        return Err(media_error());
    }
    let file: File = super::asset_mods::open_read_no_follow(path).map_err(|_| media_error())?;
    let opened = file.metadata().map_err(|_| media_error())?;
    if !opened.is_file()
        || super::asset_mods::metadata_is_reparse(&opened)
        || opened.len() != before.len()
        || opened.len() > MAX_SOURCE_BYTES as u64
    {
        return Err(media_error());
    }
    let mut bytes = Vec::with_capacity(opened.len() as usize);
    file.take(MAX_SOURCE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| media_error())?;
    if bytes.is_empty() || bytes.len() > MAX_SOURCE_BYTES || bytes.len() as u64 != opened.len() {
        return Err(media_error());
    }
    Ok(bytes)
}

fn decode_png_rgba(bytes: &[u8]) -> Result<RgbaImage, String> {
    if !super::asset_mods::static_png_framing_is_exact(bytes) {
        return Err(media_error());
    }
    let mut options = png::DecodeOptions::default();
    options.set_ignore_adler32(false);
    options.set_ignore_crc(false);
    options.set_skip_ancillary_crc_failures(false);
    let mut decoder = png::Decoder::new_with_options(Cursor::new(bytes), options);
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|_| media_error())?;
    let info = reader.info();
    let pixels = u64::from(info.width)
        .checked_mul(u64::from(info.height))
        .ok_or_else(media_error)?;
    if info.width == 0 || info.height == 0 || pixels > MAX_SOURCE_PIXELS {
        return Err(media_error());
    }
    let mut output = vec![0; reader.output_buffer_size()];
    let frame = reader.next_frame(&mut output).map_err(|_| media_error())?;
    reader.finish().map_err(|_| media_error())?;
    let data = &output[..frame.buffer_size()];
    let rgba = match frame.color_type {
        png::ColorType::Rgba => data.to_vec(),
        png::ColorType::Rgb => data
            .chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        png::ColorType::GrayscaleAlpha => data
            .chunks_exact(2)
            .flat_map(|p| [p[0], p[0], p[0], p[1]])
            .collect(),
        png::ColorType::Grayscale => data
            .iter()
            .flat_map(|value| [*value, *value, *value, 255])
            .collect(),
        png::ColorType::Indexed => return Err(media_error()),
    };
    RgbaImage::from_raw(frame.width, frame.height, rgba).ok_or_else(media_error)
}

fn alpha_bounds(image: &RgbaImage) -> Option<(u32, u32, u32, u32)> {
    let (mut min_x, mut min_y) = (image.width(), image.height());
    let (mut max_x, mut max_y) = (0, 0);
    let mut found = false;
    for (x, y, pixel) in image.enumerate_pixels() {
        if pixel.0[3] != 0 {
            found = true;
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
    }
    found.then_some((min_x, min_y, max_x + 1, max_y + 1))
}

fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    image::codecs::png::PngEncoder::new_with_quality(
        &mut bytes,
        image::codecs::png::CompressionType::Best,
        image::codecs::png::FilterType::Adaptive,
    )
    .write_image(
        image.as_raw(),
        image.width(),
        image.height(),
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|_| media_error())?;
    Ok(bytes)
}

fn resize_to_canvas(
    source: RgbaImage,
    canvas_width: u32,
    canvas_height: u32,
    content_width: u32,
    content_height: u32,
    bottom: Option<u32>,
    scaling: Scaling,
) -> Result<NormalizedImage, String> {
    let (left, top, right, bottom_bound) = alpha_bounds(&source).ok_or_else(media_error)?;
    let cropped =
        image::imageops::crop_imm(&source, left, top, right - left, bottom_bound - top).to_image();
    let scale = (content_width as f64 / cropped.width() as f64)
        .min(content_height as f64 / cropped.height() as f64);
    let width = ((cropped.width() as f64 * scale).round() as u32).clamp(1, content_width);
    let height = ((cropped.height() as f64 * scale).round() as u32).clamp(1, content_height);
    let filter = match scaling {
        Scaling::Linear => FilterType::Lanczos3,
        Scaling::Nearest => FilterType::Nearest,
    };
    let resized = image::imageops::resize(&cropped, width, height, filter);
    let mut canvas = RgbaImage::from_pixel(canvas_width, canvas_height, Rgba([0, 0, 0, 0]));
    let x = (canvas_width - width) / 2;
    let y = bottom.map_or((canvas_height - height) / 2, |edge| edge - height);
    image::imageops::overlay(&mut canvas, &resized, i64::from(x), i64::from(y));
    Ok(NormalizedImage {
        bytes: encode_png(&canvas)?,
        width: canvas_width,
        height: canvas_height,
        extension: "png",
        mime: "image/png",
    })
}

fn preserve_gif(bytes: Vec<u8>, width: u32, height: u32) -> Result<NormalizedImage, String> {
    let mut decoded = 0;
    super::asset_mods::validate_gif_file(&bytes, width, height, &mut decoded)
        .map_err(|_| media_error())?;
    Ok(NormalizedImage {
        bytes,
        width,
        height,
        extension: "gif",
        mime: "image/gif",
    })
}

pub fn normalize_image_path(
    path: &Path,
    sprite: bool,
    scaling: Scaling,
) -> Result<NormalizedImage, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .ok_or_else(media_error)?;
    if extension.eq_ignore_ascii_case("gif") {
        let (width, height) = if sprite { (64, 64) } else { (48, 48) };
        return preserve_gif(read_source(path)?, width, height);
    }
    if !extension.eq_ignore_ascii_case("png") {
        return Err(media_error());
    }
    let image = decode_png_rgba(&read_source(path)?)?;
    if sprite {
        resize_to_canvas(image, 64, 64, 56, 60, Some(62), scaling)
    } else {
        resize_to_canvas(image, 48, 48, 48, 48, None, scaling)
    }
}

pub fn normalize_image_bytes(
    bytes: Vec<u8>,
    sprite: bool,
    scaling: Scaling,
) -> Result<NormalizedImage, String> {
    if bytes.is_empty() || bytes.len() > MAX_SOURCE_BYTES {
        return Err(media_error());
    }
    let image = decode_png_rgba(&bytes)?;
    if sprite {
        resize_to_canvas(image, 64, 64, 56, 60, Some(62), scaling)
    } else {
        resize_to_canvas(image, 48, 48, 48, 48, None, scaling)
    }
}

fn normalize_block_die_image(bytes: Vec<u8>) -> Result<NormalizedImage, String> {
    if bytes.is_empty() || bytes.len() > MAX_SOURCE_BYTES {
        return Err(media_error());
    }
    let image = decode_png_rgba(&bytes)?;
    if image.width() < 32 || image.height() < 32 {
        return Err(media_error());
    }
    let side = image.width().max(image.height());
    let mut canvas = RgbaImage::from_pixel(side, side, Rgba([0, 0, 0, 0]));
    image::imageops::overlay(
        &mut canvas,
        &image,
        i64::from((side - image.width()) / 2),
        i64::from((side - image.height()) / 2),
    );
    Ok(NormalizedImage {
        bytes: encode_png(&canvas)?,
        width: side,
        height: side,
        extension: "png",
        mime: "image/png",
    })
}

pub fn normalize_block_die_image_path(path: &Path) -> Result<NormalizedImage, String> {
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
    {
        return Err(media_error());
    }
    normalize_block_die_image(read_source(path)?)
}

pub fn normalize_block_die_image_bytes(bytes: Vec<u8>) -> Result<NormalizedImage, String> {
    normalize_block_die_image(bytes)
}

/** Normalize a user-selected pitch to the renderer's fixed upstream-compatible
 * canvas without cropping its edges. Weather mappings may safely share the
 * resulting immutable blob. */
pub fn normalize_pitch_image_path(path: &Path) -> Result<NormalizedImage, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .ok_or_else(media_error)?;
    if extension.eq_ignore_ascii_case("gif") {
        return preserve_gif(read_source(path)?, 782, 452);
    }
    if !extension.eq_ignore_ascii_case("png") {
        return Err(media_error());
    }
    let image = decode_png_rgba(&read_source(path)?)?;
    let normalized = if image.dimensions() == (782, 452) {
        image
    } else {
        image::imageops::resize(&image, 782, 452, FilterType::Lanczos3)
    };
    Ok(NormalizedImage {
        bytes: encode_png(&normalized)?,
        width: 782,
        height: 452,
        extension: "png",
        mime: "image/png",
    })
}

fn audio_extension(path: &Path) -> Result<&str, String> {
    let value = path
        .extension()
        .and_then(|value| value.to_str())
        .ok_or_else(media_error)?;
    if value.eq_ignore_ascii_case("ogg") {
        Ok("ogg")
    } else if value.eq_ignore_ascii_case("wav") {
        Ok("wav")
    } else if value.eq_ignore_ascii_case("mp3") {
        Ok("mp3")
    } else {
        Err(media_error())
    }
}

fn ogg_bos_pages(bytes: &[u8]) -> usize {
    let mut cursor = 0;
    let mut count = 0;
    while cursor + 27 <= bytes.len() {
        let Some(relative) = bytes[cursor..].windows(4).position(|part| part == b"OggS") else {
            break;
        };
        cursor += relative;
        if cursor + 27 > bytes.len() {
            break;
        }
        if bytes[cursor + 5] & 0x02 != 0 {
            count += 1;
        }
        let segments = bytes[cursor + 26] as usize;
        if cursor + 27 + segments > bytes.len() {
            break;
        }
        let payload: usize = bytes[cursor + 27..cursor + 27 + segments]
            .iter()
            .map(|value| *value as usize)
            .sum();
        cursor = cursor.saturating_add(27 + segments + payload);
    }
    count
}

fn canonical_wav(samples: &[i16], channels: u16, sample_rate: u32) -> Result<Vec<u8>, String> {
    let data_len = samples.len().checked_mul(2).ok_or_else(media_error)?;
    let riff_len = 36_usize.checked_add(data_len).ok_or_else(media_error)?;
    if 44_usize
        .checked_add(data_len)
        .is_none_or(|total| total > MAX_AUDIO_OUTPUT_BYTES)
        || riff_len > u32::MAX as usize
    {
        return Err(media_error());
    }
    let byte_rate = sample_rate
        .checked_mul(u32::from(channels))
        .and_then(|value| value.checked_mul(2))
        .ok_or_else(media_error)?;
    let block_align = channels.checked_mul(2).ok_or_else(media_error)?;
    let mut output = Vec::with_capacity(44 + data_len);
    output.extend_from_slice(b"RIFF");
    output.extend_from_slice(&(riff_len as u32).to_le_bytes());
    output.extend_from_slice(b"WAVEfmt \x10\0\0\0\x01\0");
    output.extend_from_slice(&channels.to_le_bytes());
    output.extend_from_slice(&sample_rate.to_le_bytes());
    output.extend_from_slice(&byte_rate.to_le_bytes());
    output.extend_from_slice(&block_align.to_le_bytes());
    output.extend_from_slice(&16_u16.to_le_bytes());
    output.extend_from_slice(b"data");
    output.extend_from_slice(&(data_len as u32).to_le_bytes());
    for sample in samples {
        output.extend_from_slice(&sample.to_le_bytes());
    }
    Ok(output)
}

pub fn normalize_sound_bytes(bytes: Vec<u8>, extension: &str) -> Result<NormalizedSound, String> {
    if bytes.is_empty() || bytes.len() > MAX_SOURCE_BYTES {
        return Err(media_error());
    }
    match extension {
        "wav" if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" => {
            return Err(media_error())
        }
        "ogg" if bytes.len() < 4 || &bytes[..4] != b"OggS" || ogg_bos_pages(&bytes) != 1 => {
            return Err(media_error())
        }
        "mp3"
            if !(bytes.starts_with(b"ID3")
                || (bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0)) =>
        {
            return Err(media_error())
        }
        "wav" | "ogg" | "mp3" => {}
        _ => return Err(media_error()),
    }
    let mut hint = Hint::new();
    hint.with_extension(extension);
    let source = MediaSourceStream::new(Box::new(Cursor::new(bytes)), Default::default());
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|_| media_error())?;
    let mut format = probed.format;
    if format.tracks().len() != 1 {
        return Err(media_error());
    }
    let track = format.default_track().ok_or_else(media_error)?;
    let codec = track.codec_params.codec;
    let codec_allowed = match extension {
        "ogg" => codec == CODEC_TYPE_VORBIS,
        "mp3" => codec == CODEC_TYPE_MP3,
        "wav" => matches!(
            codec,
            CODEC_TYPE_PCM_U8 | CODEC_TYPE_PCM_S16LE | CODEC_TYPE_PCM_S24LE | CODEC_TYPE_PCM_S32LE
        ),
        _ => false,
    };
    let sample_rate = track.codec_params.sample_rate.ok_or_else(media_error)?;
    let channels = track.codec_params.channels.ok_or_else(media_error)?.count();
    if !codec_allowed || !(8_000..=96_000).contains(&sample_rate) || !(1..=2).contains(&channels) {
        return Err(media_error());
    }
    let track_id = track.id;
    let params = track.codec_params.clone();
    let max_frames = u64::from(sample_rate) * MAX_AUDIO_SECONDS;
    if params.n_frames.is_some_and(|frames| frames > max_frames) {
        return Err(media_error());
    }
    let mut decoder = symphonia::default::get_codecs()
        .make(&params, &DecoderOptions::default())
        .map_err(|_| media_error())?;
    let mut frames = 0_u64;
    let mut samples = Vec::<i16>::new();
    let mut packets = 0_usize;
    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(Error::IoError(error)) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
                break
            }
            Err(_) => return Err(media_error()),
        };
        if packet.track_id() != track_id {
            return Err(media_error());
        }
        packets = packets.checked_add(1).ok_or_else(media_error)?;
        if packets > MAX_AUDIO_PACKETS
            || packet.dur() > max_frames
            || frames
                .checked_add(packet.dur())
                .is_none_or(|predicted| predicted > max_frames)
        {
            return Err(media_error());
        }
        let decoded = decoder.decode(&packet).map_err(|_| media_error())?;
        if decoded.spec().rate != sample_rate || decoded.spec().channels.count() != channels {
            return Err(media_error());
        }
        let packet_frames = decoded.frames() as u64;
        // Vorbis streams may contain a legal zero-frame priming packet. Symphonia's
        // interleaver assumes at least one frame, so skip it and retain the final
        // non-empty-output requirement below.
        if packet_frames == 0 {
            continue;
        }
        frames = frames.checked_add(packet_frames).ok_or_else(media_error)?;
        if frames > max_frames {
            return Err(media_error());
        }
        let sample_count = decoded
            .frames()
            .checked_mul(channels)
            .ok_or_else(media_error)?;
        let mut converted = SampleBuffer::<f32>::new(decoded.frames() as u64, *decoded.spec());
        converted.copy_interleaved_ref(decoded);
        if converted.samples().len() != sample_count
            || converted.samples().iter().any(|sample| !sample.is_finite())
        {
            return Err(media_error());
        }
        let next_len = samples
            .len()
            .checked_add(sample_count)
            .and_then(|value| value.checked_mul(2))
            .ok_or_else(media_error)?;
        if next_len > MAX_AUDIO_OUTPUT_BYTES {
            return Err(media_error());
        }
        samples.extend(
            converted
                .samples()
                .iter()
                .map(|sample| (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16),
        );
    }
    if frames == 0 || samples.is_empty() {
        return Err(media_error());
    }
    let duration_ms = frames
        .checked_mul(1000)
        .and_then(|value| value.checked_div(u64::from(sample_rate)))
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(media_error)?;
    Ok(NormalizedSound {
        bytes: canonical_wav(&samples, channels as u16, sample_rate)?,
        duration_ms,
        channels: channels as u8,
        sample_rate,
    })
}

pub fn normalize_sound_path(path: &Path) -> Result<NormalizedSound, String> {
    normalize_sound_bytes(read_source(path)?, audio_extension(path)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn rgba_png(width: u32, height: u32) -> Vec<u8> {
        let image = RgbaImage::from_pixel(width, height, Rgba([1, 2, 3, 255]));
        encode_png(&image).unwrap()
    }

    fn gif_bytes(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut bytes);
            encoder
                .encode_frame(image::Frame::new(image::RgbaImage::from_pixel(
                    width,
                    height,
                    image::Rgba([1, 2, 3, 255]),
                )))
                .unwrap();
        }
        bytes
    }

    #[test]
    fn canonical_wav_has_exact_pcm16_header() {
        let wav = canonical_wav(&[-32767, 0, 32767], 1, 8_000).unwrap();
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[36..40], b"data");
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 6);
    }

    #[test]
    fn chained_ogg_is_detected_before_decode() {
        let mut fake = b"OggS\0\x02".to_vec();
        fake.resize(27, 0);
        let second = fake.clone();
        fake.extend_from_slice(&second);
        assert_eq!(ogg_bos_pages(&fake), 2);
        assert!(normalize_sound_bytes(fake, "ogg").is_err());
    }

    #[test]
    fn mp3_id3_tags_and_frame_sync_spoofs_fail_closed() {
        let mut id3_only = b"ID3\x04\0\0\0\0\0\0".to_vec();
        id3_only.extend_from_slice(b"not an MPEG audio frame");
        assert!(normalize_sound_bytes(id3_only, "mp3").is_err());
        assert!(normalize_sound_bytes(vec![0xff, 0xfb, 0, 0, 0, 0], "mp3").is_err());
        let wav = canonical_wav(&[0; 80], 1, 8_000).unwrap();
        assert!(normalize_sound_bytes(wav, "mp3").is_err());
    }

    #[test]
    fn png_normalization_strips_metadata_and_uses_frozen_canvases() {
        let root = tempdir().unwrap();
        let path = root.path().join("source.png");
        let mut source = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut source, 2, 4);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .add_text_chunk("author".into(), "must not survive".into())
                .unwrap();
            let mut writer = encoder.write_header().unwrap();
            let mut pixels = vec![0; 2 * 4 * 4];
            pixels[3] = 255;
            pixels[7] = 255;
            writer.write_image_data(&pixels).unwrap();
        }
        std::fs::write(&path, source).unwrap();
        let icon = normalize_image_path(&path, false, Scaling::Nearest).unwrap();
        let sprite = normalize_image_path(&path, true, Scaling::Nearest).unwrap();
        assert_eq!((icon.width, icon.height), (48, 48));
        assert_eq!((sprite.width, sprite.height), (64, 64));
        assert!(super::super::asset_mods::static_png_framing_is_exact(
            &icon.bytes
        ));
        assert!(!icon.bytes.windows(4).any(|chunk| chunk == b"tEXt"));
        let decoded = decode_png_rgba(&sprite.bytes).unwrap();
        assert!(decoded.rows().nth(61).unwrap().any(|pixel| pixel.0[3] != 0));
        assert!(decoded
            .rows()
            .skip(62)
            .flatten()
            .all(|pixel| pixel.0[3] == 0));
    }

    #[test]
    fn exact_canvas_gif_is_preserved_byte_for_byte() {
        let root = tempdir().unwrap();
        let path = root.path().join("source.gif");
        let source = gif_bytes(64, 64);
        std::fs::write(&path, &source).unwrap();
        let normalized = normalize_image_path(&path, true, Scaling::Nearest).unwrap();
        assert_eq!(normalized.bytes, source);
        assert_eq!(normalized.mime, "image/gif");
        assert_eq!(normalized.extension, "gif");

        std::fs::write(&path, gif_bytes(48, 48)).unwrap();
        assert!(normalize_image_path(&path, true, Scaling::Nearest).is_err());
    }

    #[test]
    fn block_die_normalizer_accepts_upstream_size_and_rejects_tiny_images() {
        let accepted = normalize_block_die_image_bytes(rgba_png(35, 35)).unwrap();
        assert_eq!((accepted.width, accepted.height), (35, 35));
        assert!(normalize_block_die_image_bytes(rgba_png(20, 20)).is_err());

        let padded = normalize_block_die_image_bytes(rgba_png(35, 40)).unwrap();
        assert_eq!((padded.width, padded.height), (40, 40));
    }

    #[test]
    fn pcm_wav_is_decoded_and_reencoded_canonically() {
        let input = canonical_wav(&vec![0; 8_000], 1, 8_000).unwrap();
        let normalized = normalize_sound_bytes(input, "wav").unwrap();
        assert_eq!(normalized.duration_ms, 1_000);
        assert_eq!(normalized.channels, 1);
        assert_eq!(normalized.sample_rate, 8_000);
        assert_eq!(&normalized.bytes[12..16], b"fmt ");
        assert_eq!(normalized.bytes.len(), 44 + 16_000);
    }

    #[test]
    fn float_and_over_duration_wav_are_rejected_before_publication() {
        let mut float = canonical_wav(&[0, 0], 1, 8_000).unwrap();
        float[20..22].copy_from_slice(&3_u16.to_le_bytes());
        assert!(normalize_sound_bytes(float, "wav").is_err());
        let too_long = canonical_wav(&vec![0; 8_000 * 20 + 1], 1, 8_000).unwrap();
        assert!(normalize_sound_bytes(too_long, "wav").is_err());
    }

    #[test]
    fn existing_vorbis_fixture_passes_the_bounded_decoder() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/assets/sounds/block.ogg");
        let normalized = normalize_sound_path(&path).unwrap();
        assert!((1..=20_000).contains(&normalized.duration_ms));
        assert!(normalized.bytes.len() <= MAX_AUDIO_OUTPUT_BYTES);
    }
}
