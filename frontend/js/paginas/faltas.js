// Shinatal — página "Minhas faltas" (colaborador).
import { db } from "../firebase-init.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { exigirAutenticacao } from "../auth.js";
import { formatarData, escaparHTML } from "../ui-utils.js";

const perfil = await exigirAutenticacao(["colaborador"]);
const lista = document.getElementById("lista-faltas");

try {
  const snap = await getDocs(query(collection(db, "faltas"), where("uid", "==", perfil.uid)));
  const faltas = snap.docs.map((d) => d.data()).sort((a, b) => (a.data < b.data ? 1 : -1));
  const injustificadas = faltas.filter((f) => !f.justificada).length;
  document.getElementById("faltas-total").textContent = faltas.length;
  document.getElementById("faltas-injustificadas").textContent = injustificadas;
  document.getElementById("faltas-justificadas").textContent = faltas.length - injustificadas;

  lista.innerHTML = faltas.length
    ? faltas.map((f) => `
      <li>
        <div>
          <p class="registro-titulo">${formatarData(f.data)}</p>
          <p class="registro-detalhe">${escaparHTML(f.motivo) || "Sem motivo registrado"}</p>
        </div>
        <span class="badge ${f.justificada ? "badge-sucesso" : "badge-perigo"}">${f.justificada ? "Justificada" : "Injustificada"}</span>
      </li>`).join("")
    : `<li class="estado-vazio"><span class="material-symbols-outlined" aria-hidden="true">celebration</span><p class="estado-vazio-titulo">Nenhuma falta registrada</p><p>Continue assim para garantir o bônus de excelência.</p></li>`;
} catch (erro) {
  console.error("[Shinatal] Falha ao carregar faltas:", erro);
  lista.innerHTML = `<li class="estado-vazio"><span class="material-symbols-outlined" aria-hidden="true">error</span><p class="estado-vazio-titulo">Não foi possível carregar suas faltas</p><p>Tente novamente em instantes.</p></li>`;
}
