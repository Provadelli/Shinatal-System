// Shinatal — página "Minhas advertências" (colaborador).
import { db } from "../firebase-init.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { exigirAutenticacao } from "../auth.js";
import { formatarData, escaparHTML } from "../ui-utils.js";

const ROTULOS = {
  verbal: "Advertência verbal",
  escrita: "Advertência escrita",
  suspensao1: "1ª suspensão",
  suspensao2: "2ª suspensão",
  suspensao3: "3ª suspensão"
};

const perfil = await exigirAutenticacao(["colaborador"]);
const lista = document.getElementById("lista-advertencias");

try {
  const snap = await getDocs(query(collection(db, "advertencias"), where("uid", "==", perfil.uid)));
  const itens = snap.docs.map((d) => d.data()).sort((a, b) => (a.data < b.data ? 1 : -1));
  const suspensoes = itens.filter((a) => String(a.tipo).startsWith("suspensao")).length;
  document.getElementById("adv-advertencias").textContent = itens.length - suspensoes;
  document.getElementById("adv-suspensoes").textContent = suspensoes;

  lista.innerHTML = itens.length
    ? itens.map((a) => `
      <li>
        <div>
          <p class="registro-titulo">${escaparHTML(ROTULOS[a.tipo] || a.tipo)}</p>
          <p class="registro-detalhe">${escaparHTML(a.motivo) || "Sem motivo registrado"}</p>
        </div>
        <span class="registro-data">${formatarData(a.data)}</span>
      </li>`).join("")
    : `<li class="estado-vazio"><span class="material-symbols-outlined" aria-hidden="true">verified</span><p class="estado-vazio-titulo">Nenhuma advertência registrada</p><p>Seu histórico disciplinar está limpo.</p></li>`;
} catch (erro) {
  console.error("[Shinatal] Falha ao carregar advertências:", erro);
  lista.innerHTML = `<li class="estado-vazio"><span class="material-symbols-outlined" aria-hidden="true">error</span><p class="estado-vazio-titulo">Não foi possível carregar suas advertências</p><p>Tente novamente em instantes.</p></li>`;
}
