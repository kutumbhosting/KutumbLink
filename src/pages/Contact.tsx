import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Phone, Mail } from "lucide-react";
import { Link } from "react-router-dom";

const Contact = () => {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
  });

  const contactInfo = [
    {
      icon: MapPin,
      title: "Address",
      details: "Sydney, New South Wales, Australia",
      color: "text-primary",
    },
    {
      icon: Phone,
      title: "Phone",
      details: "+61 412 830 048",
      link: "tel:+61412830048",
      color: "text-primary",
    },
    {
      icon: Mail,
      title: "Email",
      details: "info@kutumb.org.au",
      link: "mailto:info@kutumb.org.au",
      color: "text-primary",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow">

        {/* Hero - MATCHED */}
        <section className="gradient-warm text-white py-20">
          <div className="container mx-auto px-4 text-center">
            <h1 className="mb-6">Contact Us</h1>
            <p className="text-xl max-w-3xl mx-auto opacity-95">
              Have questions or want to get involved? We'd love to hear from you.
            </p>
          </div>
        </section>

        {/* Contact Cards */}
        <section className="py-20">
          <div className="container mx-auto px-4">

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto mb-16">

              {contactInfo.map((info, index) => {
                const Icon = info.icon;
                return (
                  <Card key={index} className="text-center card-hover border-2">
                    <CardContent className="p-6">

                      {/* Icon - unified style */}
                      <div className="w-16 h-16 bg-gradient-hero rounded-full flex items-center justify-center mx-auto mb-4">
                        <Icon className="w-8 h-8 text-white" />
                      </div>

                      <h3 className="font-bold mb-2">{info.title}</h3>

                      {info.link ? (
                        <a
                          href={info.link}
                          className={`${info.color} hover:underline text-sm`}
                        >
                          {info.details}
                        </a>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {info.details}
                        </p>
                      )}

                    </CardContent>
                  </Card>
                );
              })}

            </div>
          </div>
        </section>

        {/* Form + Side Panel */}
        <section className="py-20 bg-muted/30">
          <div className="container mx-auto px-4">

            <div className="grid lg:grid-cols-2 gap-12 max-w-6xl mx-auto">

              {/* FORM */}
              <Card className="border-2">
                <CardContent className="p-8">

                  <h2 className="mb-6">Send Us a Message</h2>

                  <form className="space-y-6">

                    <div className="grid md:grid-cols-2 gap-4">

                      <div>
                        <Label>Name *</Label>
                        <Input className="mt-2" />
                      </div>

                      <div>
                        <Label>Phone</Label>
                        <Input className="mt-2" />
                      </div>

                    </div>

                    <div>
                      <Label>Email *</Label>
                      <Input type="email" className="mt-2" />
                    </div>

                    <div>
                      <Label>Subject</Label>
                      <Input className="mt-2" />
                    </div>

                    <div>
                      <Label>Message *</Label>
                      <Textarea className="mt-2 min-h-32" />
                    </div>

                    <Button className="w-full btn-hero text-lg py-6">
                      Send Message
                    </Button>

                  </form>
                </CardContent>
              </Card>

              {/* SIDE PANEL */}
              <div className="space-y-8">

                <Card className="border-2">
                  <CardContent className="p-8">

                    <h3 className="text-2xl font-bold mb-4">Quick Links</h3>

                    <div className="space-y-3">

                      <a href="/membership" className="block text-primary hover:underline font-medium">
                        → Become a Member
                      </a>

                      <a href="/events" className="block text-primary hover:underline font-medium">
                        → Register for Events
                      </a>

                      <a href="/executive" className="block text-primary hover:underline font-medium">
                        → Meet Our Team
                      </a>

                    </div>

                  </CardContent>
                </Card>

                {/* CTA CARD - MATCHED */}
                <Card className="gradient-warm text-white border-2">
                  <CardContent className="p-8 text-center">

                    <h3 className="text-2xl font-bold mb-4">
                      Join Our Community
                    </h3>

                    <p className="mb-6 opacity-95">
                      Become a member and be part of meaningful community change.
                    </p>

<Link to="/membership" state={{ scrollTo: "membership" }}>
  <Button className="w-full bg-white text-primary hover:bg-white/90">
    Join Now
  </Button>
</Link>
                  </CardContent>
                </Card>

              </div>
            </div>
          </div>
        </section>

        {/* FAQ - unified cards */}
        <section className="py-20">
          <div className="container mx-auto px-4">

            <div className="max-w-4xl mx-auto">
              <h2 className="mb-12 text-center">Frequently Asked Questions</h2>

              <div className="space-y-6">

                {[
                  {
                    q: "How can I become a member?",
                    a: "Go to Membership page and fill the form. It's free.",
                  },
                  {
                    q: "Are events open to everyone?",
                    a: "Yes, most events are open to public with priority for members.",
                  },
                  {
                    q: "How can I volunteer?",
                    a: "Contact us or join events directly from Events page.",
                  },
                  {
                    q: "Do you accept donations?",
                    a: "Yes, as a registered non-profit we accept community donations.",
                  },
                ].map((item, i) => (
                  <Card key={i} className="border-2 card-hover">
                    <CardContent className="p-6">
                      <h4 className="font-bold mb-2">{item.q}</h4>
                      <p className="text-muted-foreground">{item.a}</p>
                    </CardContent>
                  </Card>
                ))}

              </div>
            </div>

          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
};

export default Contact;

