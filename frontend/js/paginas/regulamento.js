// Shinatal — página "Regulamento" (qualquer papel logado). O texto é estático no HTML; aqui só
// exigimos o login (que também monta o cabeçalho do papel).
import { exigirAutenticacao } from "../auth.js";

await exigirAutenticacao(null);
