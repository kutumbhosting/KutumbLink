import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Phone, Mail } from "lucide-react";

interface TeamMember {
  name: string;
  role: string;
  phone: string;
  email: string;
  bio: string;
  image: string;
}

const Executive = () => {
  const [team, setTeam] = useState<TeamMember[]>([]);

  useEffect(() => {
    fetch("/api/team")
      .then((res) => res.json())
      .then((data) => setTeam(data))
      .catch((err) => console.error("Error loading team:", err));
  }, []);

  const getGradientClass = (index: number) => {
    const gradients = [
      "bg-gradient-hero",
      "bg-gradient-to-br from-primary/80 to-primary",
      "bg-gradient-to-br from-secondary/80 to-emerald-600",
      "bg-gradient-to-br from-accent/80 to-orange-600",
      "bg-gradient-to-br from-purple-500/80 to-purple-700",
      "bg-gradient-to-br from-blue-500/80 to-blue-700",
      "bg-gradient-to-br from-pink-500/80 to-pink-700",
    ];
    return gradients[index % gradients.length];
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow">
        <section className="gradient-warm text-white py-20">
          <div className="container mx-auto px-4 text-center">
            <h1 className="mb-6">Executive Team</h1>
            <p className="text-xl max-w-3xl mx-auto opacity-95">
              Meet the dedicated individuals who lead Kutumb with passion, integrity, and a commitment to community service.
            </p>
          </div>
        </section>

        <section className="py-20">
          <div className="container mx-auto px-4">
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
              {team.map((member, index) => (
                <Card key={index} className="card-hover border-2 overflow-hidden">
                  <CardContent className="p-0">

                    <div className={`h-48 flex items-center justify-center ${getGradientClass(index)}`}>
                      {member.image ? (
                        <img
                          src={`/team-images/${member.image}`}
                          alt={member.name}
                          className="w-40 h-40 object-cover rounded-full shadow-lg border-4 border-white"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="text-6xl font-bold text-white">
                          {member.name.charAt(0)}
                        </div>
                      )}
                    </div>

                    <div className="p-6">
                      <h3 className="text-xl font-bold mb-1">{member.name}</h3>
                      <div className="text-primary font-semibold mb-4">{member.role}</div>
                      <p className="text-muted-foreground text-sm mb-6 leading-relaxed">
                        {member.bio}
                      </p>
                      {/* Contact */}
                      <div className="space-y-2 pt-4 border-t">
                        <a
                          href={`tel:${member.phone}`}
                          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
                        >
                          <Phone size={16} className="text-primary" />
                          {member.phone}
                        </a>

                        <a
                          href={`mailto:${member.email}`}
                          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
                        >
                          <Mail size={16} className="text-primary" />
                          {member.email}
                        </a>
                      </div>

                    </div>

                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 bg-muted/30">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="mb-6">Want to Get Involved?</h2>
              <p className="text-lg text-muted-foreground mb-8">
                We're always looking for passionate individuals who want to make a difference in our community.
              </p>
              <a href="/contact">
                <button className="btn-hero">Contact Us</button>
              </a>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Executive;


