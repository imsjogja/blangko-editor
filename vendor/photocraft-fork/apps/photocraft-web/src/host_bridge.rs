//! Blangko Editor host bridge: native bytes, commands, revisions and exports.

use std::sync::{Arc, Mutex, PoisonError};

use js_sys::{Reflect, Uint8Array};
use photocraft_ui_egui::{ExportSettings, PhotocraftApp};
use serde_json::{Value, json};
use wasm_bindgen::{JsCast as _, JsValue, closure::Closure};
use web_sys::CustomEvent;

const COMMAND_EVENT: &str = "blangko:command";
const HOST_EVENT: &str = "blangko:event";

#[derive(Debug)]
enum HostRequest {
    Open { id: String, name: String, bytes: Vec<u8> },
    Command { id: String, method: String, params: Value },
    Export { id: String, format: String },
}

#[derive(Clone, Default)]
pub struct HostBridge {
    queue: Arc<Mutex<Vec<HostRequest>>>,
    started: Arc<Mutex<bool>>,
}

fn property(value: &JsValue, key: &str) -> Option<JsValue> {
    Reflect::get(value, &JsValue::from_str(key)).ok().filter(|value| !value.is_undefined())
}

fn text(value: &JsValue, key: &str) -> Option<String> {
    property(value, key)?.as_string()
}

fn host_event(detail: &JsValue) -> Result<CustomEvent, JsValue> {
    let init = web_sys::CustomEventInit::new();
    init.set_detail(detail);
    CustomEvent::new_with_event_init_dict(HOST_EVENT, &init)
}

fn emit(value: Value) {
    let Some(window) = web_sys::window() else { return };
    let detail = JsValue::from_str(&value.to_string());
    let Ok(event) = host_event(&detail) else { return };
    let _ = window.dispatch_event(&event);
}

fn reply(id: String, ok: bool, payload: Value) {
    emit(json!({"type": "reply", "id": id, "ok": ok, "payload": payload}));
}

impl HostBridge {
    pub fn listen(&self, ctx: &egui::Context) {
        let Some(window) = web_sys::window() else { return };
        let queue = self.queue.clone();
        let ctx = ctx.clone();
        let callback = Closure::<dyn FnMut(CustomEvent)>::new(move |event: CustomEvent| {
            ctx.request_repaint();
            let detail = event.detail();
            let Some(kind) = text(&detail, "type") else { return };
            let id = text(&detail, "id").unwrap_or_default();
            let request = match kind.as_str() {
                "open" => {
                    let Some(name) = text(&detail, "name") else { return };
                    let Some(bytes) = property(&detail, "bytes") else { return };
                    if !bytes.is_instance_of::<Uint8Array>() { return; }
                    HostRequest::Open { id, name, bytes: Uint8Array::new(&bytes).to_vec() }
                }
                "command" => {
                    let Some(method) = text(&detail, "method") else { return };
                    let params = text(&detail, "params")
                        .and_then(|value| serde_json::from_str(&value).ok())
                        .unwrap_or_else(|| json!({}));
                    HostRequest::Command { id, method, params }
                }
                "export" => {
                    let format = text(&detail, "format").unwrap_or_else(|| "pcraft".into());
                    HostRequest::Export { id, format }
                }
                _ => return,
            };
            queue.lock().unwrap_or_else(PoisonError::into_inner).push(request);
        });
        if window.add_event_listener_with_callback(COMMAND_EVENT, callback.as_ref().unchecked_ref()).is_ok() {
            callback.forget();
        }
    }

    pub fn before_frame(&mut self, app: &mut PhotocraftApp, ctx: &egui::Context) {
        let requests = std::mem::take(&mut *self.queue.lock().unwrap_or_else(PoisonError::into_inner));
        for request in requests {
            match request {
                HostRequest::Open { id, name, bytes } => {
                    ctx.request_repaint();
                    let closed = app.session.execute("file.closeAll", json!({"save": false}));
                    let result = closed.map_err(|error| error.to_string()).and_then(|_| {
                        app.open_automation_bytes(&name, &bytes).map(|warnings| json!({"warnings": warnings}))
                    });
                    match result {
                        Ok(payload) => reply(id, true, payload),
                        Err(error) => reply(id, false, json!({"message": error})),
                    }
                }
                HostRequest::Command { id, method, params } => {
                    let result = if method == "engine.execute" {
                        let command = params.get("command").and_then(Value::as_str).unwrap_or_default();
                        let command_params = params.get("params").cloned().unwrap_or_else(|| json!({}));
                        if command.is_empty() {
                            Err("Perintah engine.execute wajib menyertakan command.".to_string())
                        } else {
                            ctx.request_repaint();
                            app.session.execute(command, command_params).map_err(|error| error.to_string())
                        }
                    } else {
                        Err(format!("Metode bridge tidak didukung: {method}"))
                    };
                    match result {
                        Ok(payload) => reply(id, true, payload),
                        Err(error) => reply(id, false, json!({"message": error})),
                    }
                }
                HostRequest::Export { id, format } => {
                    let format = if format.eq_ignore_ascii_case("png") { "png" } else { "pcraft" };
                    let result = (|| {
                        let state = app.session.active().ok_or("Tidak ada dokumen PhotoCraft aktif.")?;
                        let export = app.services.export.as_ref().ok_or("Exporter PhotoCraft tidak tersedia.")?;
                        let (bytes, warnings) = export(&state.doc, &format!("blangko-native.{format}"), &ExportSettings::default())
                            .map_err(|error| error.to_string())?;
                        Ok::<(Vec<u8>, Vec<String>), String>((bytes, warnings))
                    })();
                    match result {
                        Ok((bytes, warnings)) => {
                            let Some(window) = web_sys::window() else { continue };
                            let payload = js_sys::Object::new();
                            let _ = Reflect::set(&payload, &"type".into(), &"export".into());
                            let _ = Reflect::set(&payload, &"id".into(), &id.into());
                            let _ = Reflect::set(&payload, &"format".into(), &format.into());
                            let _ = Reflect::set(&payload, &"warnings".into(), &JsValue::from_str(&json!(warnings).to_string()));
                            let _ = Reflect::set(&payload, &"bytes".into(), &Uint8Array::from(bytes.as_slice()));
                            if let Ok(event) = host_event(&payload) {
                                let _ = window.dispatch_event(&event);
                            }
                        }
                        Err(error) => reply(id, false, json!({"message": error})),
                    }
                }
            }
        }
        let mut started = self.started.lock().unwrap_or_else(PoisonError::into_inner);
        if !*started {
            *started = true;
            emit(json!({"type": "ready", "engine": "photocraft-fork", "protocol": 1}));
        }
    }

    pub fn after_frame(
        &mut self,
        app: &PhotocraftApp,
        revision: &mut Option<(photocraft_doc::DocId, u64, Vec<photocraft_doc::LayerId>)>,
    ) {
        let current = app.session.active().map(|state| {
            (state.doc.id, state.revision, state.selected_layers().to_vec())
        });
        if current == *revision {
            return;
        }
        *revision = current.clone();
        let Some((document, active_revision, selection)) = current else {
            emit(json!({"type": "revision", "document": Value::Null}));
            return;
        };
        let Some(document_state) = app.session.active() else { return };
        let selected = selection.iter().filter_map(|id| {
            let layer = document_state.doc.layer(*id)?;
            Some(json!({"id": layer.id, "name": layer.name}))
        }).collect::<Vec<_>>();
        emit(json!({
            "type": "revision",
            "document": document,
            "revision": active_revision,
            "pixelRevision": document_state.pixel_revision,
            "selected": selected,
        }));
    }
}
