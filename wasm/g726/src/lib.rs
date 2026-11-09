use oxideav_adpcm::g726::{decode_packet, BitOrder, BitUnpacker, Rate, State};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct G726Decoder {
    state: State,
    unpacker: BitUnpacker,
}

#[wasm_bindgen]
impl G726Decoder {
    #[wasm_bindgen(constructor)]
    pub fn new(kilobits_per_second: u32, bit_order: &str) -> Result<G726Decoder, JsValue> {
        let rate = match kilobits_per_second {
            16 => Rate::R16,
            24 => Rate::R24,
            32 => Rate::R32,
            40 => Rate::R40,
            _ => return Err(JsValue::from_str("Taxa G.726 inválida.")),
        };
        let order = match bit_order {
            "msb" => BitOrder::MsbFirst,
            "lsb" => BitOrder::LsbFirst,
            _ => return Err(JsValue::from_str("Ordem de bits G.726 inválida.")),
        };
        Ok(Self {
            state: State::new(rate),
            unpacker: BitUnpacker::new(order),
        })
    }

    pub fn decode(&mut self, bytes: &[u8]) -> Vec<i16> {
        let mut pcm = Vec::with_capacity(bytes.len() * 2);
        decode_packet(bytes, &mut self.state, &mut self.unpacker, &mut pcm);
        pcm
    }

    pub fn reset(&mut self, kilobits_per_second: u32) -> Result<(), JsValue> {
        let rate = match kilobits_per_second {
            16 => Rate::R16,
            24 => Rate::R24,
            32 => Rate::R32,
            40 => Rate::R40,
            _ => return Err(JsValue::from_str("Taxa G.726 inválida.")),
        };
        self.state = State::new(rate);
        self.unpacker.reset();
        Ok(())
    }
}
