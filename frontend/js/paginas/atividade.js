// Shinatal — página "Log de atividade" (Admin e Presidente).
import { db } from "../firebase-init.js";
import {
  collection, query, orderBy, limit, onSnapshot, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { exigirAutenticacao } from "../auth.js";
import { escaparHTML, formatarDataHora, confirmarAcao, mostrarToast, debounce } from "../ui-utils.js";
import { registrarLog } from "../log-service.js";

const perfil = await exigirAutenticacao(["admin", "presidente"]);
const lista = document.getElementById("lista-log");

onSnapshot(query(collection(db, "logs"), orderBy("criadoEm", "desc"), limit(100)), debounce((snap) => {
  if (!snap.size) {
    lista.innerHTML = `<li class="estado-vazio"><span class="material-symbols-outlined" aria-hidden="true">history</span><p class="estado-vazio-titulo">Nenhuma ação registrada ainda</p></li>`;
    return;
  }
  lista.innerHTML = snap.docs.map((d) => {
    const l = d.data();
    return `
      <li>
        <div class="min-w-0">
          <p class="registro-titulo">${escaparHTML(l.descricao || l.tipo)}</p>
          <p class="registro-detalhe">${escaparHTML(l.operadorNome) || "Sistema"}${l.alvoNome ? ` <span aria-hidden="true">→</span><span class="sr-only">sobre</span> ${escaparHTML(l.alvoNome)}` : ""}</p>
        </div>
        <span class="registro-data">${l.criadoEm ? formatarDataHora(l.criadoEm) : "agora"}</span>
      </li>`;
  }).join("");
}, 150), (erro) => {
  console.error("[Shinatal] Falha ao carregar o log:", erro);
  mostrarToast("Não foi possível carregar o log de atividade.", "erro");
});

document.getElementById("btn-excluir-log").addEventListener("click", async () => {
  const ok = await confirmarAcao({
    titulo: "Excluir todo o log de atividade",
    mensagem: "Isso apaga PERMANENTEMENTE todo o histórico de ações registradas. Esta ação não pode ser desfeita.",
    textoConfirmar: "Excluir tudo",
    perigo: true
  });
  if (!ok) return;
  try {
    const docs = (await getDocs(collection(db, "logs"))).docs;
    for (let i = 0; i < docs.length; i += 450) {
      const lote = writeBatch(db);
      docs.slice(i, i + 450).forEach((d) => lote.delete(d.ref));
      await lote.commit();
    }
    // Registrado depois de excluir: vira a primeira entrada do log novo (quem limpou e quando).
    await registrarLog(perfil, "log_limpo", `Log de atividade excluído (${docs.length} registro(s) removido(s))`);
    mostrarToast("Log de atividade excluído.", "sucesso");
  } catch (erro) {
    console.error("[Shinatal] Falha ao excluir o log:", erro);
    mostrarToast("Não foi possível excluir o log.", "erro");
  }
});
