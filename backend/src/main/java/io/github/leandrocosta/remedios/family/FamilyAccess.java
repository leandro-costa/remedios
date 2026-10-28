package io.github.leandrocosta.remedios.family;

import io.github.leandrocosta.remedios.common.ApiException;
import io.github.leandrocosta.remedios.user.CurrentUser;
import jakarta.enterprise.context.RequestScoped;
import java.util.UUID;

/**
 * Autorização por família (seção 3.2). Toda leitura ou escrita no escopo de
 * uma família passa por aqui. Quem não é membro ativo recebe 404, para não
 * revelar a existência da família.
 */
@RequestScoped
public class FamilyAccess {

    private final CurrentUser currentUser;

    public FamilyAccess(CurrentUser currentUser) {
        this.currentUser = currentUser;
    }

    public FamilyMember requireMember(UUID familyId) {
        return FamilyMember.findActive(familyId, currentUser.id())
                .orElseThrow(() -> ApiException.notFound("Família"));
    }

    public FamilyMember requireAdmin(UUID familyId) {
        FamilyMember member = requireMember(familyId);
        if (!member.isAdmin()) {
            throw ApiException.forbidden("Somente administradores da família podem realizar esta ação.");
        }
        return member;
    }
}
