import * as React from "react";
import { Camera, Check, Loader2, RotateCcw, Square, Video, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Grava no máximo 2 minutos por vídeo — evita arquivo enorme sem perceber. */
const DURACAO_MAX_VIDEO_S = 120;

type Estado = "abrindo" | "pronta" | "gravando" | "revisando" | "erro";

interface Capturado {
  file: File;
  url: string;
}

function mensagemErro(err: unknown): string {
  const nome = err instanceof DOMException ? err.name : "";
  if (nome === "NotAllowedError" || nome === "PermissionDeniedError") {
    return "Permissão da câmera negada — habilite o acesso à câmera nas configurações do navegador e tente de novo.";
  }
  if (nome === "NotFoundError" || nome === "DevicesNotFoundError") {
    return "Nenhuma câmera encontrada neste dispositivo.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "Este navegador (ou a conexão, se não for https) não dá acesso à câmera.";
  }
  return "Não foi possível abrir a câmera. Tente de novo.";
}

/**
 * Captura foto/vídeo direto na página (getUserMedia + MediaRecorder), sem
 * abrir o app de câmera do celular. Existe porque o `<input capture>` faz o
 * navegador jogar a aba pra segundo plano enquanto usa a câmera nativa — em
 * celulares com pouca RAM (ou gravações mais longas) o sistema às vezes
 * descarta a aba nesse meio tempo, perdendo o arquivo e sem sinal nenhum de
 * erro pro usuário. Ficando na própria página, a aba nunca sai de primeiro
 * plano.
 */
export function CapturaCameraDialog({
  open,
  modo,
  onOpenChange,
  onCapturar,
}: {
  open: boolean;
  modo: "foto" | "video";
  onOpenChange: (open: boolean) => void;
  onCapturar: (arquivo: File) => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const gravadorRef = React.useRef<MediaRecorder | null>(null);
  const pedacosRef = React.useRef<Blob[]>([]);

  const [estado, setEstado] = React.useState<Estado>("abrindo");
  const [erro, setErro] = React.useState("");
  const [capturado, setCapturado] = React.useState<Capturado | null>(null);
  const [segundos, setSegundos] = React.useState(0);

  const pararStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  React.useEffect(() => {
    if (!open) return;
    let vivo = true;
    setEstado("abrindo");
    setErro("");
    setCapturado(null);
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: modo === "video",
      })
      .then((stream) => {
        if (!vivo) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setEstado("pronta");
      })
      .catch((err: unknown) => {
        if (!vivo) return;
        setErro(mensagemErro(err));
        setEstado("erro");
      });
    return () => {
      vivo = false;
      pararStream();
      gravadorRef.current?.stop();
      gravadorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, modo]);

  // Solta a URL do preview anterior pra não vazar memória entre capturas.
  React.useEffect(() => {
    return () => {
      if (capturado) URL.revokeObjectURL(capturado.url);
    };
  }, [capturado]);

  function fechar() {
    onOpenChange(false);
  }

  function tirarFoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        pararStream();
        setCapturado({
          file: new File([blob], `foto-${Date.now()}.jpg`, { type: "image/jpeg" }),
          url: URL.createObjectURL(blob),
        });
        setEstado("revisando");
      },
      "image/jpeg",
      0.9,
    );
  }

  function iniciarGravacao() {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = [
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find((t) => window.MediaRecorder?.isTypeSupported?.(t));
    const gravador = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    pedacosRef.current = [];
    gravador.ondataavailable = (e) => {
      if (e.data.size > 0) pedacosRef.current.push(e.data);
    };
    gravador.onstop = () => {
      const blob = new Blob(pedacosRef.current, { type: gravador.mimeType || "video/webm" });
      const ext = gravador.mimeType?.includes("mp4") ? "mp4" : "webm";
      pararStream();
      setCapturado({
        file: new File([blob], `video-${Date.now()}.${ext}`, { type: blob.type }),
        url: URL.createObjectURL(blob),
      });
      setEstado("revisando");
    };
    gravadorRef.current = gravador;
    gravador.start();
    setSegundos(0);
    setEstado("gravando");
  }

  function pararGravacao() {
    gravadorRef.current?.stop();
  }

  // Contador da gravação + parada automática no teto de duração.
  React.useEffect(() => {
    if (estado !== "gravando") return;
    const id = window.setInterval(() => {
      setSegundos((s) => {
        if (s + 1 >= DURACAO_MAX_VIDEO_S) pararGravacao();
        return s + 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [estado]);

  function refazer() {
    if (capturado) URL.revokeObjectURL(capturado.url);
    setCapturado(null);
    // Reabre a câmera do zero.
    setEstado("abrindo");
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: modo === "video" })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setEstado("pronta");
      })
      .catch((err: unknown) => {
        setErro(mensagemErro(err));
        setEstado("erro");
      });
  }

  function usar() {
    if (!capturado) return;
    onCapturar(capturado.file);
    fechar();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="flex max-w-lg flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{modo === "foto" ? "Tirar foto" : "Gravar vídeo"}</DialogTitle>
        </DialogHeader>

        <div className="relative flex min-h-64 items-center justify-center overflow-hidden rounded-lg bg-black">
          {estado === "abrindo" && <Loader2 className="size-8 animate-spin text-white/80" />}
          {estado === "erro" && (
            <p className="max-w-xs px-4 text-center text-sm text-white/90">{erro}</p>
          )}
          {(estado === "pronta" || estado === "gravando") && (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="max-h-[60vh] w-full object-contain"
            />
          )}
          {estado === "revisando" &&
            capturado &&
            (modo === "foto" ? (
              <img
                src={capturado.url}
                className="max-h-[60vh] w-full object-contain"
                alt="Foto capturada"
              />
            ) : (
              <video
                src={capturado.url}
                controls
                playsInline
                className="max-h-[60vh] w-full object-contain"
              />
            ))}
          {estado === "gravando" && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground">
              <span className="size-2 animate-pulse rounded-full bg-white" />
              {String(Math.floor(segundos / 60)).padStart(2, "0")}:
              {String(segundos % 60).padStart(2, "0")}
            </span>
          )}
        </div>
        <canvas ref={canvasRef} hidden />

        <div className="flex justify-end gap-2">
          {estado === "revisando" ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={refazer}
              >
                <RotateCcw className="size-4" />
                Refazer
              </Button>
              <Button type="button" size="sm" className="gap-1.5" onClick={usar}>
                <Check className="size-4" />
                Usar
              </Button>
            </>
          ) : estado === "gravando" ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="gap-1.5"
              onClick={pararGravacao}
            >
              <Square className="size-4" />
              Parar
            </Button>
          ) : estado === "pronta" ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={fechar}
              >
                <X className="size-4" />
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                onClick={modo === "foto" ? tirarFoto : iniciarGravacao}
              >
                {modo === "foto" ? <Camera className="size-4" /> : <Video className="size-4" />}
                {modo === "foto" ? "Capturar" : "Gravar"}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={fechar}>
              <X className="size-4" />
              Fechar
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
