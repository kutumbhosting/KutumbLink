import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { X } from "lucide-react";

interface Activity {
  title: string;
  image?: string;
  image1?: string;
  image2?: string;
  description: string;
  schedule: string;
  location?: string;
  participationOptions?: string[];
  onlineYoga?: string[];
  inPersonYoga?: string[];
  bhajanDetails?: string[];
  benefits: string[];
}

interface RegForm {
  activityTitle: string;
  name: string;
  address: string;
  email: string;
  phone: string;
  howToParticipate: string;
  activityLocation: string;
  preferredDate: string;
  availability: string;
  notes: string;
}

const emptyForm = (title = ""): RegForm => ({
  activityTitle: title,
  name: "",
  address: "",
  email: "",
  phone: "",
  howToParticipate: "",
  activityLocation: "",
  preferredDate: "",
  availability: "all-day",
  notes: "",
});

const Activities = () => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [form, setForm] = useState<RegForm>(emptyForm());
  const [submitMessage, setSubmitMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/activities")
      .then((res) => res.json())
      .then((data) => setActivities(data))
      .catch((err) => console.error("Failed to load activities:", err));
  }, []);

  const openModal = (activity: Activity) => {
    setSelectedActivity(activity);
    setForm(emptyForm(activity.title));
    setSubmitMessage("");
  };

  const closeModal = () => {
    setSelectedActivity(null);
    setForm(emptyForm());
    setSubmitMessage("");
  };

  const handleChange = (field: keyof RegForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.phone) {
      setSubmitMessage("Please fill in all required fields.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/activity-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.status === 409) {
        setSubmitMessage("You are already registered for this activity.");
      } else if (!res.ok) {
        setSubmitMessage(data.message || "Submission failed. Try again.");
      } else {
        setSubmitMessage("Registration successful! We will be in touch.");
        setTimeout(() => closeModal(), 2500);
      }
    } catch {
      setSubmitMessage("Submission failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow">
        <section className="gradient-warm text-white py-20">
          <div className="container mx-auto px-4 text-center">
            <h1 className="mb-6">Our Regular Activities</h1>
            <p className="text-xl max-w-3xl mx-auto opacity-95">
              Engage with your community through activities that promote wellness,
              compassion, and social impact.
            </p>
          </div>
        </section>

        <section className="py-20">
          <div className="container mx-auto px-4">
            <div className="space-y-16 max-w-6xl mx-auto">
              {activities.map((activity, index) => (
                <div
                  key={index}
                  className={`grid md:grid-cols-2 gap-8 items-center ${
                    index % 2 === 1 ? "md:grid-flow-dense" : ""
                  }`}
                >
                  {/* Image Section */}
                  <div className={index % 2 === 1 ? "md:col-start-2" : ""}>
                    <div className="flex flex-col gap-4">
                      {activity.image1 && (
                        <img
                          src={`/activity-images/${activity.image1}`}
                          alt={activity.title}
                          className="w-full h-72 object-cover rounded-xl shadow-lg"
                        />
                      )}
                      {activity.image2 && (
                        <img
                          src={`/activity-images/${activity.image2}`}
                          alt={activity.title}
                          className="w-full h-72 object-cover rounded-xl shadow-lg"
                        />
                      )}
                      {!activity.image1 && activity.image && (
                        <img
                          src={`/activity-images/${activity.image}`}
                          alt={activity.title}
                          className="w-full h-80 object-cover rounded-xl shadow-lg"
                        />
                      )}
                    </div>
                  </div>

                  {/* Content */}
                  <div className={index % 2 === 1 ? "md:col-start-1 md:row-start-1" : ""}>
                    <Card className="border-2 h-full">
                      <CardContent className="p-8">
                        <h2 className="mb-4">{activity.title}</h2>
                        <p className="text-muted-foreground mb-6">{activity.description}</p>

                        <div className="space-y-4 mb-6 p-4 bg-muted/50 rounded-lg">
                          <div>
                            <span className="font-semibold text-primary">Schedule: </span>
                            {activity.schedule}
                          </div>
                          {activity.onlineYoga && (
                            <ul className="text-sm">
                              {activity.onlineYoga.map((item, i) => (
                                <li key={i}>✓ {item}</li>
                              ))}
                            </ul>
                          )}
                          {activity.inPersonYoga && (
                            <ul className="text-sm">
                              {activity.inPersonYoga.map((item, i) => (
                                <li key={i}>✓ {item}</li>
                              ))}
                            </ul>
                          )}
                          {activity.bhajanDetails && (
                            <ul className="text-sm">
                              {activity.bhajanDetails.map((item, i) => (
                                <li key={i}>✓ {item}</li>
                              ))}
                            </ul>
                          )}
                          {activity.location && (
                            <div>
                              <span className="font-semibold text-primary">Location: </span>
                              {activity.location}
                            </div>
                          )}
                        </div>

                        <ul className="mb-6 text-sm">
                          {activity.benefits.map((b, i) => (
                            <li key={i}>✓ {b}</li>
                          ))}
                        </ul>

                        <Button className="w-full" onClick={() => openModal(activity)}>
                          Register for This Activity
                        </Button>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />

      {/* ── MODAL ── */}
      {selectedActivity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-background rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto relative">

            {/* Close button */}
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
            >
              <X size={22} />
            </button>

            <div className="p-8">
              <h2 className="text-2xl font-bold mb-1">Register</h2>
              <p className="text-primary font-semibold mb-6">{selectedActivity.title}</p>

              <form onSubmit={handleSubmit} className="space-y-4">

                {/* Activity — pre-filled, read only */}
                <div>
                  <Label>Activity</Label>
                  <Input value={form.activityTitle} readOnly className="mt-1 bg-muted" />
                </div>

                {/* Name */}
                <div>
                  <Label>Full Name *</Label>
                  <Input
                    className="mt-1"
                    placeholder="Your full name"
                    value={form.name}
                    onChange={(e) => handleChange("name", e.target.value)}
                  />
                </div>

                {/* Email */}
                <div>
                  <Label>Email *</Label>
                  <Input
                    className="mt-1"
                    type="email"
                    placeholder="your@email.com"
                    value={form.email}
                    onChange={(e) => handleChange("email", e.target.value)}
                  />
                </div>

                {/* Phone */}
                <div>
                  <Label>Phone *</Label>
                  <Input
                    className="mt-1"
                    type="tel"
                    placeholder="+61 XXX XXX XXX"
                    value={form.phone}
                    onChange={(e) => handleChange("phone", e.target.value)}
                  />
                </div>

                {/* Address */}
                <div>
                  <Label>Address</Label>
                  <Input
                    className="mt-1"
                    placeholder="Your suburb or address"
                    value={form.address}
                    onChange={(e) => handleChange("address", e.target.value)}
                  />
                </div>

                {/* How to participate */}
                <div>
                  <Label>How Would You Like to Participate?</Label>
                  <select
                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
                    value={form.howToParticipate}
                    onChange={(e) => handleChange("howToParticipate", e.target.value)}
                  >
                    <option value="">Select an option</option>
                    {selectedActivity.participationOptions?.map((opt, i) => (
                      <option key={i} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {/* Location */}
                <div>
                  <Label>Preferred Location</Label>
                  <Input
                    className="mt-1"
                    placeholder="e.g. The Ponds Park, Zoom, etc."
                    value={form.activityLocation}
                    onChange={(e) => handleChange("activityLocation", e.target.value)}
                  />
                </div>

                {/* Preferred date */}
                <div>
                  <Label>Preferred Start Date</Label>
                  <Input
                    className="mt-1"
                    type="date"
                    value={form.preferredDate}
                    onChange={(e) => handleChange("preferredDate", e.target.value)}
                  />
                </div>

                {/* Availability */}
                <div>
                  <Label>Availability</Label>
                  <select
                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
                    value={form.availability}
                    onChange={(e) => handleChange("availability", e.target.value)}
                  >
                    <option value="all-day">All Day / Every Session</option>
                    <option value="morning">Morning Only</option>
                    <option value="afternoon">Afternoon Only</option>
                    <option value="evening">Evening Only</option>
                    <option value="specific">Specific Days Only</option>
                  </select>
                </div>

                {/* Notes */}
                <div>
                  <Label>Additional Notes</Label>
                  <Textarea
                    className="mt-1"
                    placeholder="Any special requirements or questions?"
                    value={form.notes}
                    onChange={(e) => handleChange("notes", e.target.value)}
                  />
                </div>

                {submitMessage && (
                  <p className={`text-sm text-center ${
                    submitMessage.includes("successful") ? "text-green-600" : "text-red-600"
                  }`}>
                    {submitMessage}
                  </p>
                )}

                <Button type="submit" className="w-full btn-hero" disabled={submitting}>
                  {submitting ? "Submitting..." : "Submit Registration"}
                </Button>

              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Activities;
